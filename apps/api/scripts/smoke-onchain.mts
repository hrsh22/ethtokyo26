/** Local Anvil + isolated SQLite integration smoke with test-process-only partner fixtures. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { setTimeout as delay } from "node:timers/promises";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { spaceAccountAbi, type SpacePermit } from "@accord/chain";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseEther, toHex, zeroAddress, type Abi, type Address, type Hex, type LocalAccount } from "viem";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { labelhash, namehash } from "viem/ens";

const rpc = "http://127.0.0.1:8546";
const base = "http://127.0.0.1:4001";
const mnemonic = "test test test test test test test test test test test junk";
const funder = mnemonicToAccount(mnemonic, { addressIndex: 0 });
const owner = privateKeyToAccount(generatePrivateKey());
const human = privateKeyToAccount(generatePrivateKey());
const agent = mnemonicToAccount(mnemonic, { addressIndex: 2 });
const seller = mnemonicToAccount(mnemonic, { addressIndex: 3 });
const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ chain: sepolia, transport: http(rpc) });

type Artifact = { abi: Abi; bytecode: { object: Hex } };
async function artifact(path: string) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")) as Artifact;
}

async function deploy(path: string, args: readonly unknown[] = []) {
  const compiled = await artifact(path);
  const hash = await wallet.deployContract({ account: owner, abi: compiled.abi, bytecode: compiled.bytecode.object, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Deployment failed: ${path}`);
  return { address: receipt.contractAddress, abi: compiled.abi };
}

async function request(path: string, payload?: unknown, token?: string) {
  const response = await fetch(`${base}${path}`, {
    method: payload === undefined ? "GET" : "POST",
    headers: { ...(payload === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, body: body as Record<string, unknown> | null };
}

function assertStatus(actual: number, expected: number, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
}

async function signIn(account: LocalAccount) {
  const challenge = await request("/v1/auth/challenge", { address: account.address });
  assertStatus(challenge.status, 200, "SIWE challenge");
  const signature = await account.signMessage({ message: String(challenge.body!.message) });
  const verified = await request("/v1/auth/verify", {
    id: challenge.body!.id, address: account.address, signature, client: "agent",
  });
  assertStatus(verified.status, 200, "SIWE verification");
  if (typeof verified.body?.token !== "string") throw new Error("Missing bearer token");
  return verified.body.token;
}

async function send(to: Address, data: Hex, account: LocalAccount = owner) {
  const hash = await wallet.sendTransaction({ account, to, data });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Contract transaction reverted");
  return hash;
}

function permitFrom(body: Record<string, unknown>): SpacePermit {
  const permit = body.permit as Record<string, unknown>;
  return {
    actor: String(permit.actor) as Address,
    action: Number(permit.action) as SpacePermit["action"],
    allocationId: BigInt(String(permit.allocationId)),
    recipient: String(permit.recipient) as Address,
    amount: BigInt(String(permit.amount)),
    requestId: String(permit.requestId) as Hex,
    nonce: BigInt(String(permit.nonce)),
    expiry: BigInt(String(permit.expiry)),
    policyVersion: BigInt(String(permit.policyVersion)),
    detailsHash: String(permit.detailsHash) as Hex,
  };
}

function selfieResult(challenge: Record<string, unknown>, sessionId: string, userPresence: boolean) {
  const rp = challenge.rpContext as Record<string, unknown>;
  return {
    protocol_version: "4.0", nonce: rp.nonce, session_id: sessionId, environment: "staging",
    ...(userPresence ? { user_presence_completed: true } : {}),
    responses: [{ identifier: "selfie", issuer_schema_id: 11,
      signal_hash: hashSignal(String(challenge.signal)),
      session_nullifier: [`0x${randomBytes(32).toString("hex")}`, `0x${randomBytes(32).toString("hex")}`] }],
  };
}

async function main() {
  if (!/^0x[0-9a-fA-F]{64}$/.test(process.env.PERMIT_SIGNER_PRIVATE_KEY ?? "")) {
    throw new Error("Set a local PERMIT_SIGNER_PRIVATE_KEY");
  }
  if (await publicClient.getChainId() !== 11155111) throw new Error("Anvil must use Sepolia chain ID");
  const rpcOwner = (await publicClient.request({ method: "eth_accounts" } as never) as Address[])[0];
  if (rpcOwner?.toLowerCase() !== funder.address.toLowerCase()) throw new Error("Use Anvil's default test mnemonic");
  const fundingTx = await wallet.sendTransaction({ account: funder, to: owner.address, value: parseEther("10") });
  await publicClient.waitForTransactionReceipt({ hash: fundingTx });

  const token = await deploy("../../../contracts/out/SpaceAccount.t.sol/DemoToken.json");
  const adapter = await deploy("../../../contracts/out/EnsPermissionAdapter.sol/EnsPermissionAdapter.json");
  const factory = await deploy("../../../contracts/out/SpaceFactory.sol/SpaceFactory.json", [zeroAddress]);
  const registry = await deploy("../../../contracts/out/SpaceAccount.t.sol/MockEnsV2Registry.json");
  const resolver = await deploy("../../../contracts/out/MockRecipientResolver.sol/MockRecipientResolver.json");
  await send(resolver.address, encodeFunctionData({ abi: resolver.abi, functionName: "setAddress", args: [namehash("family.eth"), human.address] }));
  const authorizer = privateKeyToAccount(process.env.PERMIT_SIGNER_PRIVATE_KEY as Hex).address;
  const humanGas = await wallet.sendTransaction({ account: owner, to: human.address, value: parseEther("0.01") });
  await publicClient.waitForTransactionReceipt({ hash: humanGas });
  const createTx = await wallet.writeContract({ account: owner, address: factory.address, abi: factory.abi,
    functionName: "createSpace", args: [authorizer, token.address, adapter.address] });
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
  if (createReceipt.status !== "success") throw new Error("Factory creation failed");

  const env = { ...process.env, RESEARCH_SELLER_ADDRESS: seller.address, RESEARCH_PRICE_BASE_UNITS: "5", API_PORT: "4001", SEPOLIA_RPC_URL: rpc, SEPOLIA_HISTORY_RPC_URL: rpc,
    SPACE_FACTORY_ADDRESS: factory.address, ENS_ADAPTER_ADDRESS: adapter.address,
    ENSV2_REGISTRY_ADDRESS: registry.address, ENSV2_UNIVERSAL_RESOLVER_ADDRESS: resolver.address, DEMO_TOKEN_ADDRESS: token.address,
    WORLD_APP_ID: "app_local_anvil", WORLD_RP_ID: "rp_local_anvil",
    WORLD_RP_SIGNING_KEY: generatePrivateKey(), WORLD_ENVIRONMENT: "staging",
    INTERCEPTA_API_KEY: "local-test-only", ACCORD_PARTNER_MOCKS: "local-only",
    MOCK_INTERCEPTA_ERROR_ADDRESS: human.address, MOCK_INTERCEPTA_BLOCK_ADDRESS: owner.address };
  const server = spawn(process.execPath, ["--import", "./scripts/mock-partners.mjs",
    "--import", "tsx", "src/index.ts"], {
    cwd: new URL("..", import.meta.url), env, stdio: ["ignore", "pipe", "pipe"],
  });
  let serverError = "";
  server.stderr?.on("data", (chunk) => { serverError += String(chunk); });
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      try { if ((await request("/v1/health")).status === 200) break; } catch { /* starting */ }
      if (attempt === 39) throw new Error(`API did not start: ${serverError.slice(0, 1000)}`);
      await delay(150);
    }
    const ownerToken = await signIn(owner);
    const humanToken = await signIn(human);
    const agentToken = await signIn(agent);
    const draft = await request("/v1/spaces/drafts", { name: `Onchain smoke ${randomUUID().slice(0, 8)}`,
      templateId: "recurring-support" }, ownerToken);
    assertStatus(draft.status, 200, "Create draft");
    const draftId = String(draft.body!.id);
    const wrongActivation = await request("/v1/spaces/activate", { draftId, deploymentTx: `0x${"0".repeat(64)}` }, ownerToken);
    assertStatus(wrongActivation.status, 400, "Reject unrelated receipt");
    const activated = await request("/v1/spaces/activate", { draftId, deploymentTx: createTx }, ownerToken);
    assertStatus(activated.status, 200, "Activate trusted Space");
    const retryActivation = await request("/v1/spaces/activate", { draftId, deploymentTx: createTx }, ownerToken);
    assertStatus(retryActivation.status, 200, "Retry activation without another transaction");
    if (retryActivation.body?.spaceAddress !== activated.body?.spaceAddress || retryActivation.body?.activatedAt !== activated.body?.activatedAt) {
      throw new Error("Activation retry changed the saved Space");
    }
    assertStatus((await request("/v1/spaces/activate", { draftId, deploymentTx: createTx }, humanToken)).status, 403, "Reject another owner’s activation retry");
    assertStatus((await request("/v1/spaces/activate", { draftId, deploymentTx: `0x${"0".repeat(64)}` }, ownerToken)).status, 403, "Reject replacing an activated Space");
    const space = String(activated.body!.spaceAddress) as Address;
    const openedByHuman = await request("/v1/spaces/lookup", { spaceAddress: space }, humanToken);
    assertStatus(openedByHuman.status, 200, "Beneficiary opens shared Space");
    if (openedByHuman.body?.id !== draftId) throw new Error("Shared Space lookup returned a different draft");
    const missingSpace = await request("/v1/spaces/lookup", { spaceAddress: seller.address }, agentToken);
    assertStatus(missingSpace.status, 404, "Unknown Space lookup");
    const profile = await request("/v1/spaces/profile", { spaceAddress: space });
    assertStatus(profile.status, 200, "Public Space name without a session");
    if (profile.body?.name !== draft.body?.name || "id" in profile.body! || "owner" in profile.body!) throw new Error("Public profile returned more than the name");
    assertStatus((await request("/v1/spaces/profile", { spaceAddress: seller.address })).status, 404, "Unknown Space has no public profile");
    const config = await request("/v1/config");
    assertStatus(config.status, 200, "Public config");
    if (String(config.body?.factoryAddress).toLowerCase() !== factory.address.toLowerCase() ||
      String(config.body?.authorizerAddress).toLowerCase() !== authorizer.toLowerCase()) {
      throw new Error("Public config does not match deployment");
    }

    const mint = await wallet.writeContract({ account: owner, address: token.address, abi: token.abi,
      functionName: "mint", args: [owner.address, 1000n] });
    await publicClient.waitForTransactionReceipt({ hash: mint });
    const approve = await wallet.writeContract({ account: owner, address: token.address, abi: token.abi,
      functionName: "approve", args: [space, 1000n] });
    await publicClient.waitForTransactionReceipt({ hash: approve });
    const resolvedHuman = await request("/v1/ens/recipient", { name: " Family.ETH " });
    assertStatus(resolvedHuman.status, 200, "Resolve human ENS payment address");
    if (String(resolvedHuman.body?.address).toLowerCase() !== human.address.toLowerCase()) throw new Error("ENS did not resolve the payment wallet");
    assertStatus((await request("/v1/ens/recipient", { name: "missing.eth" })).status, 404, "Reject missing ENS payment record");
    assertStatus((await request("/v1/ens/recipient", { name: "invalid..eth" })).status, 400, "Reject invalid ENS name");
    const allocation = await request("/v1/admin/allocations", { draftId, requestKey: randomUUID(),
      beneficiary: human.address, beneficiaryEnsName: "family.eth", amount: "100", periodCap: "30", period: 1 }, ownerToken);
    assertStatus(allocation.status, 200, "Create allocation permit");
    const namesBefore = await request("/v1/ens/allocations", { spaceAddress: space, allocationIds: ["1"] });
    if ((namesBefore.body?.names as unknown[]).length !== 0) throw new Error("Unexecuted allocation label was exposed");
    await send(space, String(allocation.body!.calldata) as Hex);
    const namesAfter = await request("/v1/ens/allocations", { spaceAddress: space, allocationIds: ["1"] });
    if ((namesAfter.body?.names as Array<{name: string}>)[0]?.name !== "family.eth") throw new Error("Confirmed ENS label was not saved");
    await send(resolver.address, encodeFunctionData({ abi: resolver.abi, functionName: "setAddress", args: [namehash("family.eth"), agent.address] }));
    assertStatus((await request("/v1/admin/allocations", { draftId, requestKey: randomUUID(), beneficiary: human.address,
      beneficiaryEnsName: "family.eth", amount: "1", periodCap: "1", period: 0 }, ownerToken)).status, 409, "Reject changed ENS record before setup");
    assertStatus((await request("/v1/permits/claims", { draftId, requestKey: randomUUID(), allocationId: "1", amount: "1" }, agentToken)).status, 403, "ENS change cannot redirect an existing allocation");
    console.log("Human ENS: address resolution, saved labels, missing records, and name-change safety passed.");
    const unauthorized = await request("/v1/admin/allocations", { draftId, requestKey: randomUUID(),
      beneficiary: human.address, amount: "1", periodCap: "1", period: 0 }, humanToken);
    assertStatus(unauthorized.status, 403, "Reject non-owner setup");

    const claim = await request("/v1/permits/claims", { draftId, requestKey: randomUUID(),
      allocationId: "1", amount: "25" }, humanToken);
    assertStatus(claim.status, 200, "Prepare beneficiary claim");
    if (claim.body?.signature) throw new Error("Claim signed before World approval");
    const premature = await request("/v1/permits/claims/sign", { intentId: claim.body!.id }, humanToken);
    assertStatus(premature.status, 403, "Reject claim without World proof");
    const noSession = await request("/v1/world/challenge", { mode: "claim", intentId: claim.body!.id }, humanToken);
    assertStatus(noSession.status, 403, "Reject World continuity without enrollment");
    const enrolledSessionId = `session_${randomBytes(64).toString("hex")}`;
    const enrollment = await request("/v1/world/challenge", { mode: "enroll" }, humanToken);
    assertStatus(enrollment.status, 200, "World enrollment challenge");
    const enrollmentResult = selfieResult(enrollment.body!, enrolledSessionId, false);
    const enrolled = await request("/v1/world/verify", { id: enrollment.body!.id, result: enrollmentResult }, humanToken);
    assertStatus(enrolled.status, 200, "World enrollment through test verifier");
    const replay = await request("/v1/world/verify", { id: enrollment.body!.id, result: enrollmentResult }, humanToken);
    assertStatus(replay.status, 401, "Reject reused World challenge");
    const claimChallenge = await request("/v1/world/challenge", { mode: "claim", intentId: claim.body!.id }, humanToken);
    assertStatus(claimChallenge.status, 200, "Claim-bound World challenge");
    if (claimChallenge.body?.sessionId !== enrolledSessionId ||
      claimChallenge.body?.signal !== claim.body?.digest) throw new Error("World challenge is not bound to the claim intent");
    const noPresence = await request("/v1/world/verify", {
      id: claimChallenge.body!.id, result: selfieResult(claimChallenge.body!, enrolledSessionId, false),
    }, humanToken);
    assertStatus(noPresence.status, 401, "Reject claim proof without user presence");
    const verifiedClaim = await request("/v1/world/verify", {
      id: claimChallenge.body!.id, result: selfieResult(claimChallenge.body!, enrolledSessionId, true),
    }, humanToken);
    assertStatus(verifiedClaim.status, 200, "Claim proof through test verifier");
    const signedClaim = await request("/v1/permits/claims/sign", { intentId: claim.body!.id }, humanToken);
    assertStatus(signedClaim.status, 200, "Sign verified claim permit");
    if (typeof signedClaim.body?.signature !== "string") throw new Error("Missing claim signature");
    await send(space, encodeFunctionData({ abi: spaceAccountAbi, functionName: "claim",
      args: [1n, 25n, permitFrom(signedClaim.body!), signedClaim.body.signature as Hex] }), human);
    const humanTokens = await publicClient.readContract({ address: token.address, abi: token.abi,
      functionName: "balanceOf", args: [human.address] });
    if (humanTokens !== 25n) throw new Error("Verified claim did not transfer 25 test tokens");

    const excessClaim = await request("/v1/permits/claims", { draftId, requestKey: randomUUID(),
      allocationId: "1", amount: "6" }, humanToken);
    assertStatus(excessClaim.status, 403, "Period cap rejected before World verification");
    if ((excessClaim.body?.decision as { code?: string })?.code !== "allocation_period_cap") throw new Error("Missing claim limit reason");

    const agentAllocation = await request("/v1/admin/allocations", { draftId, requestKey: randomUUID(),
      beneficiary: zeroAddress, amount: "100", periodCap: "100", period: 0 }, ownerToken);
    assertStatus(agentAllocation.status, 200, "Create agent allocation permit");
    await send(space, String(agentAllocation.body!.calldata) as Hex);
    const block = await publicClient.getBlock();
    const ensExpiry = block.timestamp + 86_400n;
    const nameId = BigInt(labelhash("agent"));
    const setState = await wallet.writeContract({ account: owner, address: registry.address, abi: registry.abi,
      functionName: "setState", args: [nameId, 2, agent.address, ensExpiry, 7n] });
    await publicClient.waitForTransactionReceipt({ hash: setState });
    const name = await request("/v1/ens/resolve", { name: "agent.eth" });
    assertStatus(name.status, 200, "Resolve ENSv2 name");
    if (name.body?.active !== true || name.body?.nameId !== nameId.toString() ||
      String(name.body?.owner).toLowerCase() !== agent.address.toLowerCase()) {
      throw new Error("ENSv2 name state did not match agent");
    }
    const mandateTerms = { draftId, allocationId: "2", agent: agent.address, registry: registry.address, nameId: nameId.toString(),
      expectedResource: "7", dailyCap: "50", maxPerPayment: "20", expiry: String(block.timestamp + 3600n) };
    assertStatus((await request("/v1/admin/mandates", { ...mandateTerms, requestKey: randomUUID(), agentEnsName: "family.eth" }, ownerToken)).status,
      400, "Reject an agent label that is not the mandate's name");
    const mandate = await request("/v1/admin/mandates", { ...mandateTerms, requestKey: randomUUID(), agentEnsName: "agent.eth" }, ownerToken);
    assertStatus(mandate.status, 200, "Set ENSv2 mandate permit");
    const agentNameBefore = await request("/v1/ens/allocations", { spaceAddress: space, allocationIds: ["2"] });
    if ((agentNameBefore.body?.names as unknown[]).length !== 0) throw new Error("Unexecuted mandate label was exposed");
    await send(space, String(mandate.body!.calldata) as Hex);
    const agentName = await request("/v1/ens/allocations", { spaceAddress: space, allocationIds: ["2"] });
    const agentLabel = (agentName.body?.names as Array<{ name: string; address: string }>)[0];
    if (agentLabel?.name !== "agent.eth" || agentLabel.address.toLowerCase() !== agent.address.toLowerCase()) throw new Error("Agent ENS label was not confirmed");
    const unavailablePayment = await request("/v1/permits/payments", { draftId, requestKey: randomUUID(),
      allocationId: "2", amount: "10", recipient: human.address }, agentToken);
    assertStatus(unavailablePayment.status, 503, "Fail closed on Intercepta outage fixture");
    const blockedPayment = await request("/v1/permits/payments", { draftId, requestKey: randomUUID(),
      allocationId: "2", amount: "10", recipient: owner.address }, agentToken);
    assertStatus(blockedPayment.status, 403, "Block risky recipient fixture");
    if ((blockedPayment.body?.decision as { code?: string; reason?: string })?.code !== "recipient_risk" ||
      !(blockedPayment.body?.decision as { reason?: string })?.reason?.includes("known scammer")) throw new Error("Risk reason was not returned");
    if ((unavailablePayment.body?.decision as { code?: string })?.code !== "screening_unavailable") throw new Error("Outage reason was not returned");
    const payment = await request("/v1/permits/payments", { draftId, requestKey: randomUUID(),
      allocationId: "2", amount: "10", recipient: seller.address }, agentToken);
    assertStatus(payment.status, 200, "Authorize clean recipient fixture");
    if (payment.body?.riskVerdict !== "allow" || typeof payment.body?.signature !== "string") {
      throw new Error("Clean recipient did not receive a signed allow permit");
    }
    await send(space, encodeFunctionData({ abi: spaceAccountAbi, functionName: "pay",
      args: [2n, seller.address, 10n, permitFrom(payment.body!), payment.body!.signature as Hex] }), agent);
    const sellerTokens = await publicClient.readContract({ address: token.address, abi: token.abi,
      functionName: "balanceOf", args: [seller.address] });
    if (sellerTokens !== 10n) throw new Error("Authorized agent payment did not transfer 10 test tokens");
    const quote = await request("/v1/research/quotes", { draftId, allocationId: "2" }, agentToken);
    assertStatus(quote.status, 200, "Agent requests a paid report quote");
    const beforePayment = await request("/v1/research/redeem", { quoteId: quote.body!.id, transactionHash: createTx }, agentToken);
    assertStatus(beforePayment.status, 403, "Report withheld without matching payment");
    const wrongPrice = await request("/v1/permits/payments", { draftId, requestKey: quote.body!.id,
      allocationId: "2", amount: "1", recipient: seller.address }, agentToken);
    assertStatus(wrongPrice.status, 400, "Quote price cannot be changed");
    const purchase = await request("/v1/permits/payments", { draftId, requestKey: quote.body!.id,
      allocationId: "2", amount: quote.body!.amount, recipient: quote.body!.recipient }, agentToken);
    assertStatus(purchase.status, 200, "Authorize exact report purchase");
    const samePurchase = await request("/v1/permits/payments", { draftId, requestKey: quote.body!.id,
      allocationId: "2", amount: quote.body!.amount, recipient: quote.body!.recipient }, agentToken);
    assertStatus(samePurchase.status, 200, "Unused valid permission can be retried");
    if (samePurchase.body?.signature !== purchase.body!.signature) throw new Error("Retry changed the purchase signature");
    const reportTx = await send(space, encodeFunctionData({ abi: spaceAccountAbi, functionName: "pay",
      args: [2n, seller.address, 5n, permitFrom(purchase.body!), purchase.body!.signature as Hex] }), agent);
    const stranger = await request("/v1/research/redeem", { quoteId: quote.body!.id, transactionHash: reportTx }, humanToken);
    assertStatus(stranger.status, 403, "Other wallets cannot redeem this purchase");
    const report = await request("/v1/research/redeem", { quoteId: quote.body!.id, transactionHash: reportTx }, agentToken);
    assertStatus(report.status, 200, "Receipt releases onchain spending report");
    if (report.body?.remaining !== "85" || report.body.dailyRemaining !== "35" || report.body.ensAuthorized !== true) throw new Error("Report did not reflect paid block state");
    const retryReport = await request("/v1/research/redeem", { quoteId: quote.body!.id, transactionHash: reportTx }, agentToken);
    assertStatus(retryReport.status, 200, "Report delivery retries without payment");
    if (JSON.stringify(report.body) !== JSON.stringify(retryReport.body)) throw new Error("Report snapshot changed on retry");
    const completedPurchase = await request("/v1/permits/payments", { draftId, requestKey: quote.body!.id,
      allocationId: "2", amount: quote.body!.amount, recipient: quote.body!.recipient }, agentToken);
    assertStatus(completedPurchase.status, 403, "Used permission is not returned as spendable");
    if ((completedPurchase.body?.decision as { code?: string })?.code !== "request_completed") throw new Error("Missing completed-payment reason");
    const history = await request("/v1/spaces/activity", { spaceAddress: space });
    assertStatus(history.status, 200, "Public onchain history needs no wallet login");
    const events = history.body?.events as Array<{ kind: string; transactionHash: string; allocationId: string; amount?: string }>;
    if (!events.some((event) => event.kind === "PaymentMade" && event.transactionHash === reportTx && event.amount === "5") ||
      !events.some((event) => event.kind === "Claimed" && event.allocationId === "1")) throw new Error("Activity omitted confirmed claim/payment");
    if (JSON.stringify(history.body).includes("session_") || "owner" in history.body! || "name" in history.body!) throw new Error("Activity exposed private metadata");
    const emptyHistory = await request("/v1/spaces/activity", { spaceAddress: space, beforeBlock: "0" });
    assertStatus(emptyHistory.status, 200, "History handles a cursor before deployment");
    if ((emptyHistory.body?.events as unknown[]).length !== 0) throw new Error("Invalid older history contents");
    const otherQuote = await request("/v1/research/quotes", { draftId, allocationId: "2" }, agentToken);
    const reused = await request("/v1/research/redeem", { quoteId: otherQuote.body!.id, transactionHash: reportTx }, agentToken);
    assertStatus(reused.status, 403, "A receipt cannot pay for a second quote");
    // Exercise the separate Node agent's complete purchase loop, not only direct API calls.
    const agentProcess = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: new URL("../../agent-demo/", import.meta.url),
      env: { PATH: process.env.PATH, HOME: process.env.HOME, API_URL: base, ACCORD_AGENT_TASK: "research",
        ACCORD_DRAFT_ID: draftId, ACCORD_ALLOCATION_ID: "2", ACCORD_SEPOLIA_RPC_URL: rpc,
        ACCORD_AGENT_PRIVATE_KEY: toHex(agent.getHdKey().privateKey!) }, stdio: ["ignore", "pipe", "pipe"],
    });
    let agentOutput = "";
    agentProcess.stdout.on("data", (chunk) => { agentOutput += String(chunk); });
    agentProcess.stderr.resume();
    const agentExit = await new Promise<number | null>((resolve, reject) => { agentProcess.on("exit", resolve); agentProcess.on("error", reject); });
    if (agentExit !== 0 || !agentOutput.includes('"step": "delivered"') || !agentOutput.includes('"remaining": "80"')) throw new Error("Node agent did not complete paid report purchase");
    // Changing ENS ownership must stop authorization even while a mandate is active.
    await send(registry.address, encodeFunctionData({ abi: registry.abi, functionName: "setState", args: [nameId, 2, owner.address, ensExpiry, 7n] }));
    const changedEns = await request("/v1/permits/payments", { draftId, requestKey: randomUUID(), allocationId: "2", amount: "1", recipient: seller.address }, agentToken);
    assertStatus(changedEns.status, 403, "ENS ownership change blocks payment");
    if ((changedEns.body?.decision as { code?: string })?.code !== "ens_authority_changed") throw new Error("Missing ENS decision reason");
    await send(registry.address, encodeFunctionData({ abi: registry.abi, functionName: "setState", args: [nameId, 2, agent.address, ensExpiry, 7n] }));
    const cachedRequest = { draftId, requestKey: randomUUID(), allocationId: "2", amount: "1", recipient: seller.address };
    const cachedPermission = await request("/v1/permits/payments", cachedRequest, agentToken);
    assertStatus(cachedPermission.status, 200, "Prepare a permission before revocation");
    const revoke = await request("/v1/admin/mandates/revoke", { draftId, requestKey: randomUUID(), allocationId: "2" }, ownerToken);
    assertStatus(revoke.status, 200, "Revoke mandate permit");
    await send(space, String(revoke.body!.calldata) as Hex);
    const stalePermission = await request("/v1/permits/payments", cachedRequest, agentToken);
    assertStatus(stalePermission.status, 403, "Cached permission is rechecked after revocation");
    if ((stalePermission.body?.decision as { code?: string })?.code !== "mandate_inactive") throw new Error("Cached retry did not explain revocation");
    const revokedPayment = await request("/v1/permits/payments", { draftId, requestKey: randomUUID(),
      allocationId: "2", amount: "10", recipient: seller.address }, agentToken);
    assertStatus(revokedPayment.status, 403, "Revoked mandate blocks new payment before screening");
    const unauthorizedRecovery = await request("/v1/admin/allocations/recover", {
      draftId, requestKey: randomUUID(), allocationId: "1",
    }, humanToken);
    assertStatus(unauthorizedRecovery.status, 403, "Reject non-owner recovery");
    for (const allocationId of ["1", "2"] as const) {
      const recovery = await request("/v1/admin/allocations/recover", {
        draftId, requestKey: randomUUID(), allocationId,
      }, ownerToken);
      assertStatus(recovery.status, 200, `Recover allocation ${allocationId}`);
      const expected = allocationId === "1" ? "75" : "80";
      const recoveryPermit = recovery.body?.permit as Record<string, unknown> | undefined;
      if (recovery.body?.functionName !== "recoverAllocation" || !recoveryPermit ||
        String(recoveryPermit.amount) !== expected) {
        throw new Error(`Recovery ${allocationId} did not bind the current unspent amount`);
      }
      await send(space, String(recovery.body!.calldata) as Hex);
      const allocation = await publicClient.readContract({ address: space, abi: spaceAccountAbi,
        functionName: "allocations", args: [BigInt(allocationId)] });
      if (!allocation[6] || allocation[1] !== 0n) throw new Error(`Allocation ${allocationId} remained open after recovery`);
    }
    const finalSpaceBalance = await publicClient.readContract({ address: token.address, abi: token.abi,
      functionName: "balanceOf", args: [space] });
    const finalOwnerBalance = await publicClient.readContract({ address: token.address, abi: token.abi,
      functionName: "balanceOf", args: [owner.address] });
    if (finalSpaceBalance !== 0n || finalOwnerBalance !== 955n) {
      throw new Error("Unspent funds were not returned to the owner");
    }
    const closedClaim = await request("/v1/permits/claims", { draftId, requestKey: randomUUID(),
      allocationId: "1", amount: "1" }, humanToken);
    assertStatus(closedClaim.status, 403, "Closed allocation blocks new claim");
    const timed = await request("/v1/admin/allocations", { draftId, requestKey: randomUUID(),
      beneficiary: human.address, amount: "50", periodCap: "10", period: 3,
      schedule: { intervalSeconds: 60, durationSeconds: 300 } }, ownerToken);
    assertStatus(timed.status, 200, "Prepare five-minute allocation");
    if (timed.body?.functionName !== "createTimedAllocation") throw new Error("Wrong scheduled entry point");
    await send(space, String(timed.body!.calldata) as Hex);
    const schedule = await publicClient.readContract({ address: space, abi: spaceAccountAbi,
      functionName: "allocationSchedules", args: [3n] });
    if (schedule[1] - schedule[0] !== 300n || schedule[2] !== 60) throw new Error("Wrong onchain schedule");
    async function timedClaim() {
      const intent = await request("/v1/permits/claims", { draftId, requestKey: randomUUID(), allocationId: "3", amount: "10" }, humanToken);
      assertStatus(intent.status, 200, "Minute claim prepare");
      assertStatus((await request("/v1/permits/claims/sign", { intentId: intent.body!.id }, humanToken)).status, 403, "Minute claims still require World proof");
      const challenge = await request("/v1/world/challenge", { mode: "claim", intentId: intent.body!.id }, humanToken);
      assertStatus(challenge.status, 200, "Minute claim World challenge");
      assertStatus((await request("/v1/world/verify", { id: challenge.body!.id,
        result: selfieResult(challenge.body!, enrolledSessionId, true) }, humanToken)).status, 200, "Fresh minute claim proof");
      const signed = await request("/v1/permits/claims/sign", { intentId: intent.body!.id }, humanToken);
      assertStatus(signed.status, 200, "Sign minute claim");
      await send(space, encodeFunctionData({ abi: spaceAccountAbi, functionName: "claim",
        args: [3n, 10n, permitFrom(signed.body!), signed.body!.signature as Hex] }), human);
    }
    await timedClaim();
    const sameMinute = await request("/v1/permits/claims", { draftId, requestKey: randomUUID(), allocationId: "3", amount: "1" }, humanToken);
    assertStatus(sameMinute.status, 403, "Block exhausted minute before World check");
    if ((sameMinute.body?.decision as {code?: string})?.code !== "allocation_period_cap") throw new Error("Missing minute-limit reason");
    await publicClient.request({ method: "evm_setNextBlockTimestamp", params: [Number(schedule[0]) + 60] } as never);
    await publicClient.request({ method: "evm_mine", params: [] } as never);
    await timedClaim();
    await publicClient.request({ method: "evm_setNextBlockTimestamp", params: [Number(schedule[1])] } as never);
    await publicClient.request({ method: "evm_mine", params: [] } as never);
    const expired = await request("/v1/permits/claims", { draftId, requestKey: randomUUID(), allocationId: "3", amount: "1" }, humanToken);
    assertStatus(expired.status, 403, "Block expired minute allocation");
    if ((expired.body?.decision as {code?: string})?.code !== "allocation_expired") throw new Error("Missing allocation expiry reason");
    const timedRecovery = await request("/v1/admin/allocations/recover", { draftId, requestKey: randomUUID(), allocationId: "3" }, ownerToken);
    assertStatus(timedRecovery.status, 200, "Recover expired minute allocation");
    await send(space, String(timedRecovery.body!.calldata) as Hex);
    console.log("Minute demo: fresh World checks, exhausted-period rejection, reset, expiry, and recovery passed.");
    console.log("Local factory, World-gated claim, ENSv2 mandate, screened agent payment, paid report delivery, separate Node agent purchase, ENS change, replay, revocation, and owner recovery checks passed (partner responses were test fixtures).");
  } finally {
    server.kill("SIGTERM");
  }
}

const tempDirectory = await mkdtemp(join(tmpdir(), "accord-onchain-"));
process.env.DATABASE_FILE = join(tempDirectory, "accord.sqlite");
const connection = createClient({ url: `file:${process.env.DATABASE_FILE}` });
try {
  await migrate(drizzle(connection), { migrationsFolder: fileURLToPath(new URL("../drizzle-sqlite", import.meta.url)) });
  await main();
} finally {
  connection.close();
  await rm(tempDirectory, { recursive: true, force: true });
}
