/** Reproducible public Sepolia owner/ENS/World-gate demo. Partner proofs remain live-only. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { accordForwarderAbi, PermitAction, spaceAccountAbi, spaceFactoryAbi, type SpacePermit } from "@accord/chain";
import {
  createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, getAddress, http, keccak256, parseAbi,
  parseUnits, parseEventLogs, toBytes, zeroAddress, type Address, type Hex, type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const rpc = process.env.SEPOLIA_RPC_URL;
const api = process.env.API_URL ?? "http://127.0.0.1:4000";
const ownerKey = process.env.DEPLOYER_PRIVATE_KEY;
const humanKey = process.env.DEMO_HUMAN_PRIVATE_KEY;
const agentKey = process.env.DEMO_AGENT_PRIVATE_KEY;
const factory = process.env.SPACE_FACTORY_ADDRESS as Address | undefined;
const adapter = process.env.ENS_ADAPTER_ADDRESS as Address | undefined;
const token = process.env.DEMO_TOKEN_ADDRESS as Address | undefined;
const registry = process.env.ENSV2_REGISTRY_ADDRESS as Address | undefined;
const name = "accordtokyodemo26.eth";
const stateUrl = new URL("../../../.codex/accord-tusdc-demo.json", import.meta.url);
const registryAbi = [{
  type: "function", name: "getState", stateMutability: "view",
  inputs: [{ name: "anyId", type: "uint256" }],
  outputs: [{ name: "state", type: "tuple", components: [
    { name: "status", type: "uint8" }, { name: "expiry", type: "uint64" },
    { name: "latestOwner", type: "address" }, { name: "tokenId", type: "uint256" },
    { name: "resource", type: "uint256" },
  ] }],
}] as const;
const transferAbi = parseAbi([
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
]);
const adapterAbi = parseAbi([
  "function isAuthorized(address registry, uint256 nameId, uint256 expectedResource, address actor) view returns (bool)",
]);

type DemoState = {
  draftId?: string;
  deploymentTx?: Hex;
  spaceAddress?: Address;
  humanAllocationId?: string;
  agentAllocationId?: string;
  mandateTx?: Hex;
  ensTransferTx?: Hex;
  paymentRequestKey?: string;
  paymentTx?: Hex;
};

function account(key: string | undefined, label: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) throw new Error(`Set ${label} in the root .env`);
  return privateKeyToAccount(key as Hex);
}
if (!rpc || !factory || !adapter || !token || !registry) throw new Error("Configure the Sepolia RPC and deployed contract addresses");
const owner = account(ownerKey, "DEPLOYER_PRIVATE_KEY");
const human = account(humanKey, "DEMO_HUMAN_PRIVATE_KEY");
const agent = account(agentKey, "DEMO_AGENT_PRIVATE_KEY");
const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ account: owner, chain: sepolia, transport: http(rpc) });
const forwarder = process.env.FORWARDER_ADDRESS as Address | undefined;

async function request(path: string, payload?: unknown, bearer?: string) {
  const response = await fetch(`${api}${path}`, {
    method: payload === undefined ? "GET" : "POST",
    headers: { ...(payload === undefined ? {} : { "content-type": "application/json" }),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  let body: Record<string, unknown> | null;
  try { body = await response.json() as Record<string, unknown>; } catch { body = null; }
  return { status: response.status, body };
}

function expectStatus(result: { status: number; body: unknown }, expected: number, step: string) {
  if (result.status !== expected) throw new Error(`${step}: HTTP ${result.status}, expected ${expected}; ${JSON.stringify(result.body)}`);
}

async function signIn(signer: typeof owner) {
  const challenge = await request("/v1/auth/challenge", { address: signer.address });
  expectStatus(challenge, 200, "SIWE challenge");
  const signature = await signer.signMessage({ message: String(challenge.body!.message) });
  const verified = await request("/v1/auth/verify", {
    id: challenge.body!.id, address: signer.address, signature, client: "agent",
  });
  expectStatus(verified, 200, "SIWE verification");
  if (typeof verified.body?.token !== "string") throw new Error("SIWE response omitted bearer token");
  return verified.body.token;
}

async function confirmed(hash: Hex, label: string) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label}: ${hash}`);
  return receipt;
}

async function sponsored(signer: typeof owner, bearer: string, to: Address, data: Hex, gas = BigInt(1_500_000)) {
  if (!forwarder) throw new Error("Configure FORWARDER_ADDRESS");
  const nonce = await publicClient.readContract({ address: forwarder, abi: accordForwarderAbi,
    functionName: "nonces", args: [signer.address] });
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const signature = await signer.signTypedData({
    domain: { name: "AccordForwarder", version: "1", chainId: sepolia.id, verifyingContract: forwarder },
    types: { ForwardRequest: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "value", type: "uint256" }, { name: "gas", type: "uint256" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" },
      { name: "data", type: "bytes" },
    ] }, primaryType: "ForwardRequest",
    message: { from: signer.address, to, value: BigInt(0), gas, nonce, deadline, data },
  });
  const result = await request("/v1/sponsor/relay", { from: signer.address, to, value: "0",
    gas: gas.toString(), nonce: nonce.toString(), deadline: String(deadline), data, signature }, bearer);
  expectStatus(result, 200, "Sponsor transaction");
  return String(result.body!.transactionHash) as Hex;
}

function assertPaymentReceipt(receipt: TransactionReceipt, space: Address, requestKey: string, allocationId: string) {
  const events = parseEventLogs({ abi: spaceAccountAbi, logs: receipt.logs, eventName: "PaymentMade" });
  if (!events.some((event) => event.address.toLowerCase() === space.toLowerCase() &&
    event.args.requestId === keccak256(toBytes(requestKey)) &&
    event.args.allocationId === BigInt(allocationId) &&
    event.args.agent.toLowerCase() === agent.address.toLowerCase() &&
    event.args.recipient.toLowerCase() === human.address.toLowerCase() &&
    event.args.amount === parseUnits("1", 6))) {
    throw new Error("Agent payment receipt lacks the expected Space event");
  }
}

async function loadState(): Promise<DemoState> {
  try { return JSON.parse(await readFile(stateUrl, "utf8")) as DemoState; }
  catch { return {}; }
}
async function saveState(state: DemoState) {
  await mkdir(new URL("../../../.codex/", import.meta.url), { recursive: true });
  await writeFile(stateUrl, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}

async function main() {
  if (await publicClient.getChainId() !== sepolia.id) throw new Error("RPC is not Ethereum Sepolia");
  const config = await request("/v1/config");
  expectStatus(config, 200, "API config");
  if (config.body?.configured !== true ||
    String(config.body.factoryAddress).toLowerCase() !== factory!.toLowerCase() ||
    String(config.body.adapterAddress).toLowerCase() !== adapter!.toLowerCase() ||
    String(config.body.demoTokenAddress).toLowerCase() !== token!.toLowerCase() ||
    String(config.body.ensRegistryAddress).toLowerCase() !== registry!.toLowerCase()) {
    throw new Error("The running API does not match root .env Sepolia deployment");
  }
  const [ownerBearer, humanBearer, agentBearer] = await Promise.all([
    signIn(owner), signIn(human), signIn(agent),
  ]);
  const state = await loadState();

  const ens = await request("/v1/ens/resolve", { name });
  expectStatus(ens, 200, "ENSv2 name resolution");
  if (ens.body?.active !== true || String(ens.body.registry).toLowerCase() !== registry!.toLowerCase()) {
    throw new Error("Demo ENSv2 name is not active in the configured registry");
  }
  let nameState = await publicClient.readContract({ address: registry!, abi: registryAbi,
    functionName: "getState", args: [BigInt(String(ens.body.nameId))] });
  if (nameState.latestOwner.toLowerCase() === owner.address.toLowerCase()) {
    const tx = await wallet.writeContract({ address: registry!, abi: transferAbi, functionName: "safeTransferFrom",
      args: [owner.address, agent.address, nameState.tokenId, 1n, "0x"] });
    await confirmed(tx, "ENSv2 agent ownership transfer");
    state.ensTransferTx = tx;
    await saveState(state);
    nameState = await publicClient.readContract({ address: registry!, abi: registryAbi,
      functionName: "getState", args: [BigInt(String(ens.body.nameId))] });
  }
  const agentAuthorized = await publicClient.readContract({ address: adapter!, abi: adapterAbi,
    functionName: "isAuthorized", args: [registry!, BigInt(String(ens.body.nameId)), nameState.resource, agent.address] });
  if (nameState.latestOwner.toLowerCase() !== agent.address.toLowerCase() || !agentAuthorized) {
    throw new Error("ENSv2 name does not authorize the distinct demo agent");
  }
  if (!state.draftId) {
    const draft = await request("/v1/spaces/drafts", { name: "Accord Sepolia demo", templateId: "research-budget" }, ownerBearer);
    expectStatus(draft, 200, "Create demo draft");
    state.draftId = String(draft.body!.id);
    await saveState(state);
  }
  if (!state.deploymentTx) {
    const tx = await sponsored(owner, ownerBearer, factory!, encodeFunctionData({ abi: spaceFactoryAbi,
      functionName: "createSpace", args: [getAddress(String(config.body!.authorizerAddress)), token!, adapter!] }), BigInt(7_500_000));
    await confirmed(tx, "Create Space");
    state.deploymentTx = tx;
    await saveState(state);
  }
  if (!state.spaceAddress) {
    const activated = await request("/v1/spaces/activate", { draftId: state.draftId, deploymentTx: state.deploymentTx }, ownerBearer);
    expectStatus(activated, 200, "Activate Space");
    state.spaceAddress = getAddress(String(activated.body!.spaceAddress));
    await saveState(state);
  }
  const space = state.spaceAddress;
  if (!space) throw new Error("Space activation did not return an address");
  const opened = await request("/v1/spaces/lookup", { spaceAddress: space }, humanBearer);
  expectStatus(opened, 200, "Beneficiary opens shared Space");

  const fundingNeeded = (state.humanAllocationId ? 0n : parseUnits("100", 6)) +
    (state.agentAllocationId ? 0n : parseUnits("100", 6));
  if (fundingNeeded > 0n) {
    const balance = await publicClient.readContract({ address: token!, abi: erc20Abi,
      functionName: "balanceOf", args: [owner.address] });
    if (balance < fundingNeeded) {
      const result = await request("/v1/sponsor/faucet", {}, ownerBearer);
      expectStatus(result, 200, "Sponsored tUSDC faucet");
      const tx = String(result.body!.transactionHash) as Hex;
      await confirmed(tx, "Demo-token faucet");
    }
    const allowance = await publicClient.readContract({ address: token!, abi: erc20Abi,
      functionName: "allowance", args: [owner.address, space] });
    if (allowance < fundingNeeded) {
      const tx = await sponsored(owner, ownerBearer, token!, encodeFunctionData({ abi: erc20Abi,
        functionName: "approve", args: [space, fundingNeeded] }), BigInt(150_000));
      await confirmed(tx, "Approve Space funding");
    }
  }

  async function createAllocation(beneficiary: Address, amount: bigint, periodCap: bigint, period: 0 | 1) {
    const permit = await request("/v1/admin/allocations", { draftId: state.draftId,
      requestKey: randomUUID(), beneficiary, amount: amount.toString(), periodCap: periodCap.toString(), period }, ownerBearer);
    expectStatus(permit, 200, "Owner allocation permit");
    const tx = await sponsored(owner, ownerBearer, space, String(permit.body!.calldata) as Hex);
    await confirmed(tx, "Create onchain allocation");
    return String((permit.body!.permit as Record<string, unknown>).allocationId);
  }
  if (!state.humanAllocationId) {
    state.humanAllocationId = await createAllocation(human.address, parseUnits("100", 6), parseUnits("10", 6), 1);
    await saveState(state);
  }
  if (!state.agentAllocationId) {
    state.agentAllocationId = await createAllocation(zeroAddress, parseUnits("100", 6), parseUnits("100", 6), 0);
    await saveState(state);
  }
  if (state.mandateTx) await confirmed(state.mandateTx, "Existing ENSv2 mandate");
  const mandateBlock = await publicClient.getBlock();
  const existingMandate = await publicClient.readContract({ address: space, abi: spaceAccountAbi,
    functionName: "mandates", args: [BigInt(state.agentAllocationId!)], blockNumber: mandateBlock.number });
  if (state.mandateTx && (!existingMandate[9] ||
    existingMandate[0].toLowerCase() !== agent.address.toLowerCase() ||
    existingMandate[1].toLowerCase() !== registry!.toLowerCase() ||
    existingMandate[2] !== BigInt(String(ens.body.nameId)) ||
    existingMandate[3] !== nameState.resource)) {
    throw new Error("Demo mandate was revoked or reassigned; refusing to restore it automatically");
  }
  if (!state.mandateTx || existingMandate[8] < mandateBlock.timestamp + 7n * 86_400n) {
    const expiry = mandateBlock.timestamp + 30n * 86_400n;
    if (expiry >= nameState.expiry) throw new Error("ENSv2 name expires before the renewed demo mandate");
    const permit = await request("/v1/admin/mandates", {
      draftId: state.draftId, requestKey: randomUUID(), allocationId: state.agentAllocationId,
      agent: agent.address, registry, nameId: String(ens.body.nameId),
      expectedResource: nameState.resource.toString(), dailyCap: parseUnits("20", 6).toString(),
      maxPerPayment: parseUnits("5", 6).toString(), expiry: String(expiry), agentEnsName: name,
    }, ownerBearer);
    expectStatus(permit, 200, "Owner ENSv2 mandate permit");
    const tx = await sponsored(owner, ownerBearer, space, String(permit.body!.calldata) as Hex);
    await confirmed(tx, state.mandateTx ? "Renew onchain ENSv2 mandate" : "Set onchain ENSv2 mandate");
    state.mandateTx = tx;
    if (!state.paymentTx) state.paymentRequestKey = undefined;
    await saveState(state);
  }
  if (state.paymentTx) {
    if (!state.paymentRequestKey) throw new Error("Payment transaction is missing its request key");
    assertPaymentReceipt(await confirmed(state.paymentTx, "Agent payment"), space,
      state.paymentRequestKey, state.agentAllocationId!);
  }

  const [spaceOwner, spaceToken, spaceAdapter, humanAllocation, agentAllocation, mandate, spaceBalance] = await Promise.all([
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "owner" }),
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "token" }),
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "ensAdapter" }),
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "allocations",
      args: [BigInt(state.humanAllocationId!)] }),
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "allocations",
      args: [BigInt(state.agentAllocationId!)] }),
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "mandates",
      args: [BigInt(state.agentAllocationId!)] }),
    publicClient.readContract({ address: token!, abi: erc20Abi, functionName: "balanceOf", args: [space] }),
  ]);
  const liveEnsAuthorized = await publicClient.readContract({ address: spaceAdapter,
    abi: adapterAbi, functionName: "isAuthorized",
    args: [mandate[1], mandate[2], mandate[3], mandate[0]] });
  if (spaceOwner.toLowerCase() !== owner.address.toLowerCase() ||
    spaceToken.toLowerCase() !== token!.toLowerCase() || spaceAdapter.toLowerCase() !== adapter!.toLowerCase() ||
    humanAllocation[0].toLowerCase() !== human.address.toLowerCase() ||
    humanAllocation[1] !== parseUnits("100", 6) || humanAllocation[2] !== parseUnits("10", 6) ||
    agentAllocation[0] !== zeroAddress ||
    agentAllocation[1] !== (state.paymentTx ? parseUnits("99", 6) : parseUnits("100", 6)) ||
    mandate[0].toLowerCase() !== agent.address.toLowerCase() ||
    mandate[1].toLowerCase() !== registry!.toLowerCase() || mandate[3] !== nameState.resource ||
    mandate[9] !== true || !liveEnsAuthorized ||
    spaceBalance < (state.paymentTx ? parseUnits("199", 6) : parseUnits("200", 6))) {
    throw new Error("Public Space state does not match the expected funded human and ENS-gated agent agreement");
  }

  const claim = await request("/v1/permits/claims", { draftId: state.draftId, requestKey: randomUUID(),
    allocationId: state.humanAllocationId, amount: parseUnits("1", 6).toString() }, humanBearer);
  expectStatus(claim, 200, "Prepare human claim");
  if (claim.body?.signature) throw new Error("Human claim signed before World ID verification");
  expectStatus(await request("/v1/permits/claims/sign", { intentId: claim.body!.id }, humanBearer), 403,
    "Reject unverified human claim");
  expectStatus(await request("/v1/world/challenge", { mode: "claim", intentId: claim.body!.id }, humanBearer), 403,
    "Reject claim proof without an enrolled World session");

  let paymentStatus: number | "settled" = "settled";
  if (!state.paymentTx) {
    if (!state.paymentRequestKey) {
      state.paymentRequestKey = randomUUID();
      await saveState(state);
    }
    const payment = await request("/v1/permits/payments", { draftId: state.draftId,
      requestKey: state.paymentRequestKey, allocationId: state.agentAllocationId,
      amount: parseUnits("1", 6).toString(), recipient: human.address }, agentBearer);
    paymentStatus = payment.status;
    if (payment.status !== 200) {
      // A failed screening attempt may have left an expiring intent in the API.
      // The next run must start with a fresh request key rather than reuse it.
      state.paymentRequestKey = undefined;
      await saveState(state);
    }
    if (!process.env.INTERCEPTA_API_KEY) expectStatus(payment, 503, "Fail closed without Intercepta key");
    else if (payment.status !== 200 && payment.status !== 403) {
      throw new Error(`Unexpected Intercepta result: HTTP ${payment.status}; ${JSON.stringify(payment.body)}`);
    }
    if (payment.status === 200) {
      const values = payment.body?.permit as Record<string, unknown> | undefined;
      if (!values || typeof payment.body?.signature !== "string" ||
        payment.body.riskVerdict !== "allow") throw new Error("Live screening did not return a signed allow permit");
      const permit: SpacePermit = {
        actor: getAddress(String(values.actor)), action: Number(values.action) as SpacePermit["action"],
        allocationId: BigInt(String(values.allocationId)), recipient: getAddress(String(values.recipient)),
        amount: BigInt(String(values.amount)), requestId: String(values.requestId) as Hex,
        nonce: BigInt(String(values.nonce)), expiry: BigInt(String(values.expiry)),
        policyVersion: BigInt(String(values.policyVersion)), detailsHash: String(values.detailsHash) as Hex,
      };
      if (permit.actor !== agent.address || permit.action !== PermitAction.Pay ||
        permit.allocationId !== BigInt(state.agentAllocationId!) ||
        permit.recipient !== human.address || permit.amount !== parseUnits("1", 6) ||
        String(payment.body.spaceAddress).toLowerCase() !== space.toLowerCase()) {
        throw new Error("Signed payment permit does not match the demo mandate");
      }
      const tx = await sponsored(agent, agentBearer, space, encodeFunctionData({ abi: spaceAccountAbi,
        functionName: "pay", args: [permit.allocationId, permit.recipient, permit.amount, permit, payment.body.signature as Hex] }));
      state.paymentTx = tx;
      await saveState(state);
      assertPaymentReceipt(await confirmed(tx, "Agent payment"), space,
        state.paymentRequestKey!, state.agentAllocationId!);
      const [remaining, funded] = await Promise.all([
        publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "allocations",
          args: [BigInt(state.agentAllocationId!)] }),
        publicClient.readContract({ address: token!, abi: erc20Abi, functionName: "balanceOf", args: [space] }),
      ]);
      if (remaining[1] !== parseUnits("99", 6) || funded < parseUnits("199", 6)) {
        throw new Error("Agent payment receipt did not match onchain allocation and Space balances");
      }
      paymentStatus = "settled";
    }
  }
  console.log(JSON.stringify({
    draftId: state.draftId, space, owner: owner.address, human: human.address, agent: agent.address,
    ensName: name, humanAllocationId: state.humanAllocationId, agentAllocationId: state.agentAllocationId,
    worldClaim: "unsigned until live World ID session", paymentStatus,
    ...(state.paymentTx ? { paymentTx: state.paymentTx } : {}),
  }, null, 2));
}

await main();
