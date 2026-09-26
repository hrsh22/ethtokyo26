/** Dry-run by default. --fork-test tests pinned ENS contracts locally; --broadcast deploys to Sepolia.
 * --activate (with --broadcast) backs up and updates .env, preserving the previous deployment allowlists.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, encodeFunctionData, erc20Abi, getAddress, http, keccak256, multicall3Abi, toBytes, zeroAddress, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, nonceManager, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { labelhash, namehash } from "viem/ens";
import { accordForwarderAbi, accordTestUSDCAbi, namedSpaceFactoryAbi, spaceNamespaceAbi, spaceAccountAbi, hierarchicalEnsPermissionAdapterAbi, forwardBatchTypes, forwardRequestTypes, agentRegistrationTypes, hashMandateTerms, signSpacePermit, hashAllocationTerms, type SpacePermit } from "@accord/chain";
import { ensFactoryAbiAddress, ensRegistryAbi, ensRegistryAbiAddress, ensResolverAbi, ensResolverAbiAddress, ENS_ROOT_REGISTRY, ENS_ROOT_ROLES } from "../src/ens-v2";

const fork = process.argv.includes("--fork-test"), broadcast = process.argv.includes("--broadcast"), activate = process.argv.includes("--activate");
if (fork && (broadcast || activate)) throw new Error("Fork tests cannot broadcast or activate a live deployment.");
if (activate && !broadcast) throw new Error("Activation requires --broadcast.");
const key = process.env.ENS_REGISTRAR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key) || !process.env.SEPOLIA_RPC_URL) throw new Error("Configure the registrar and Sepolia RPC.");
const liveOperator = privateKeyToAccount(key as Hex).address;
const parent = getAddress(process.env.ENS_NAMESPACE_REGISTRY!), parentName = process.env.ENS_NAMESPACE_NAME!;
const parentLabel = parentName.replace(/\.eth$/, "");
const port = 18547;
const anvil = fork ? spawn(process.env.ANVIL_BIN ?? "anvil", ["--silent", "--port", String(port), "--chain-id", "31337", "--fork-url", process.env.SEPOLIA_RPC_URL], { stdio: "ignore" }) : undefined;
anvil?.on("error", () => { console.error("Unable to start Anvil. Put anvil on PATH."); process.exitCode = 1; });
const chain = fork ? defineChain({ id: 31337, name: "Batching fork", nativeCurrency: sepolia.nativeCurrency, rpcUrls: { default: { http: [`http://127.0.0.1:${port}`] } } }) : sepolia;
const transport = http(fork ? `http://127.0.0.1:${port}` : process.env.SEPOLIA_RPC_URL, { timeout: 30_000 });
const client = createPublicClient({ chain, transport, pollingInterval: 1000 });
const account = privateKeyToAccount(fork ? generatePrivateKey() : key as Hex, { nonceManager });
const wallet = createWalletClient({ account, chain, transport });
const manifestUrl = new URL("../../../deployments/batching-sepolia.json", import.meta.url);
let state: Record<string, string> = {}, phase = "preflight";
if (!fork) { try { state = JSON.parse(await readFile(manifestUrl, "utf8")); } catch { /* initial deployment */ } }
async function save() { if (!fork) await writeFile(manifestUrl, JSON.stringify(state, null, 2) + "\n"); }
async function receipt(hash: Hex) {
  const value = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  assert.equal(value.status, "success", `Transaction reverted: ${hash}`);
  return value;
}
async function deploymentStep(name: string, submit: () => Promise<Hex>) {
  let hash = state[name] as Hex | undefined;
  if (!hash) { hash = await submit(); state[name] = hash; await save(); }
  return receipt(hash);
}

async function deploy(name: string, args: readonly unknown[] = []) {
  phase = `deploy ${name}`;
  const artifact = JSON.parse(await readFile(new URL(`../../../contracts/out/${name}.sol/${name}.json`, import.meta.url), "utf8"));
  const bytecode = artifact.bytecode.object as Hex, bytecodeHash = keccak256(bytecode);
  if (state[`${name}BytecodeHash`] && state[`${name}BytecodeHash`] !== bytecodeHash) throw new Error("Manifest bytecode differs from the compiled contract");
  if (state[name]) {
    const address = getAddress(state[name]!);
    assert.ok(await client.getBytecode({ address }));
    return address;
  }
  let hash = state[`${name}Tx`] as Hex | undefined;
  if (!hash) {
    hash = await wallet.deployContract({ abi: artifact.abi as Abi, bytecode, args });
    state[`${name}Tx`] = hash; state[`${name}BytecodeHash`] = bytecodeHash; await save();
  }
  const result = await receipt(hash);
  assert.ok(result.contractAddress);
  state[name] = getAddress(result.contractAddress); await save();
  console.log(`${name}: ${state[name]}`);
  return getAddress(result.contractAddress);
}

async function forkChecks(forwarder: Address, token: Address, namespace: Address, factory: Address, adapter: Address) {
  phase = "fork: create Space and ENS in one transaction";
  const user = privateKeyToAccount(generatePrivateKey());
  const nonce = () => client.readContract({ address: forwarder, abi: accordForwarderAbi, functionName: "nonces", args: [user.address] });
  async function signed(calls: { to: Address; gas: bigint; data: Hex }[]) {
    const deadline = Number((await client.getBlock()).timestamp + 300n);
    const signature = await user.signTypedData({ domain: { name: "AccordForwarder", version: "1", chainId: chain.id, verifyingContract: forwarder },
      types: forwardBatchTypes, primaryType: "ForwardBatch", message: { from: user.address, calls, nonce: await nonce(), deadline } });
    return { address: forwarder, abi: accordForwarderAbi, functionName: "executeSignedBatch", args: [user.address, calls, deadline, signature] } as const;
  }
  const name = "Batching fork test";
  const create = await signed([{ to: factory, gas: 7_500_000n, data: encodeFunctionData({ abi: namedSpaceFactoryAbi,
    functionName: "createNamedSpace", args: [account.address, token, name] }) }]);
  const created = await receipt(await wallet.writeContract(create));
  const event = created.logs.flatMap(log => { try { return [decodeEventLog({ abi: namedSpaceFactoryAbi, eventName: "SpaceCreated", ...log }).args]; } catch { return []; } })[0]!;
  assert.equal(event.owner, user.address);
  const space = event.space;
  const registry = await client.readContract({ address: namespace, abi: spaceNamespaceAbi, functionName: "registries", args: [space] });
  assert.notEqual(registry, zeroAddress);
  const label = await client.readContract({ address: namespace, abi: spaceNamespaceAbi, functionName: "labelFor", args: [space, name] });
  assert.equal(label, `batching-fork-test-${space.slice(2, 10).toLowerCase()}`);
  const resolver = await client.readContract({ address: parent, abi: ensRegistryAbi, functionName: "getResolver", args: [label] });
  assert.equal(await client.readContract({ address: resolver, abi: ensResolverAbi, functionName: "addr", args: [namehash(`${label}.${parentName}`)] }), space);
  assert.equal(await client.readContract({ address: adapter, abi: hierarchicalEnsPermissionAdapterAbi, functionName: "namespaceActive", args: [registry] }), true);
  assert.equal(await client.readContract({ address: ensFactoryAbiAddress, abi: [{ type: "function", name: "verifyContract", inputs: [{ type: "address" }], outputs: [{ type: "address" }], stateMutability: "view" }], functionName: "verifyContract", args: [registry] }), getAddress(ensRegistryAbiAddress));
  console.log(`PASS Space + registry + resolver + parent + adapter: one transaction (${created.gasUsed} gas)`);

  phase = "fork: approval and funding";
  await receipt(await wallet.writeContract({ address: token, abi: accordTestUSDCAbi, functionName: "faucetTo", args: [user.address] }));
  async function funding(amount: bigint, id: bigint) {
    const permit: SpacePermit = { actor: user.address, action: 0, allocationId: id, recipient: zeroAddress, amount,
      requestId: keccak256(toBytes(`funding-${id}`)), nonce: id, expiry: (await client.getBlock()).timestamp + 300n,
      policyVersion: await client.readContract({ address: space, abi: spaceAccountAbi, functionName: "policyVersion" }), detailsHash: hashAllocationTerms(amount, 0) };
    const signature = await signSpacePermit(account, space, permit, chain.id);
    return signed([
      { to: token, gas: 150_000n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [space, amount] }) },
      { to: space, gas: 1_500_000n, data: encodeFunctionData({ abi: spaceAccountAbi, functionName: "createAllocation", args: [zeroAddress, amount, amount, 0, permit, signature] }) },
    ]);
  }
  const fund = await funding(100_000_000n, 1n);
  phase = "fork: initial funding batch";
  const funded = await receipt(await wallet.writeContract(fund));
  assert.equal(await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [space] }), 100_000_000n);
  assert.equal(await nonce(), 2n);
  await assert.rejects(client.simulateContract({ ...fund, account }));
  phase = "fork: rollback batch";
  const failing = await funding(1_001_000_000n, 2n);
  const reverted = await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ ...failing, gas: 2_000_000n }) });
  assert.equal(reverted.status, "reverted");
  assert.equal(await client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [user.address, space] }), 0n);
  assert.equal(await nonce(), 2n);
  console.log(`PASS Approval + funding: one signature, one transaction (${funded.gasUsed} gas); replay and rollback checked`);

  phase = "fork: agent registration and revocation";
  const agent = privateKeyToAccount(generatePrivateKey()).address;
  const requestId = keccak256(toBytes("batching-agent")), expiry = (await client.getBlock()).timestamp + 86400n;
  const provision = { address: namespace, abi: spaceNamespaceAbi, functionName: "provisionAgent", args: [registry, requestId, "research", agent, expiry] } as const;
  await assert.rejects(client.simulateContract({ ...provision, account: user }));
  const preview = await client.simulateContract({ ...provision, account });
  const deadline = Number((await client.getBlock()).timestamp + 300n);
  const registrationSignature = await account.signTypedData({ domain: { name: "AccordNamespace", version: "1", chainId: chain.id, verifyingContract: namespace },
    types: agentRegistrationTypes, primaryType: "AgentRegistration", message: { registry, requestId, label: "research", agent, expiry, deadline } });
  const config = { agent, registry, nameId: BigInt(labelhash("research")), expectedResource: preview.result, dailyCap: 100_000_000n, maxPerPayment: 50_000_000n, expiry };
  const permit: SpacePermit = { actor: user.address, action: 1, allocationId: 1n, recipient: agent, amount: 0n,
    requestId: keccak256(toBytes("mandate")), nonce: 999n, expiry, policyVersion: await client.readContract({ address: space, abi: spaceAccountAbi, functionName: "policyVersion" }), detailsHash: hashMandateTerms(config) };
  const mandateSignature = await signSpacePermit(account, space, permit, chain.id);
  const grant = await signed([
    { to: namespace, gas: 1_500_000n, data: encodeFunctionData({ abi: spaceNamespaceAbi, functionName: "provisionAgentAuthorized", args: [registry, requestId, "research", agent, expiry, deadline, registrationSignature] }) },
    { to: space, gas: 1_500_000n, data: encodeFunctionData({ abi: spaceAccountAbi, functionName: "setMandate", args: [1n, config, permit, mandateSignature] }) },
  ]);
  const badGrant = await signed([
    grant.args[1][0]!,
    { to: space, gas: 1_500_000n, data: encodeFunctionData({ abi: spaceAccountAbi, functionName: "setMandate", args: [1n, config, permit, "0x00"] }) },
  ]);
  const failedGrant = await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ ...badGrant, gas: 3_000_000n }) });
  assert.equal(failedGrant.status, "reverted");
  assert.notEqual((await client.readContract({ address: registry, abi: ensRegistryAbi, functionName: "getState", args: [BigInt(labelhash("research"))] })).status, 2);
  assert.equal(await nonce(), 2n);
  await assert.rejects(client.simulateContract({ address: namespace, abi: spaceNamespaceAbi, functionName: "provisionAgentAuthorized",
    args: [registry, requestId, "research", user.address, expiry, deadline, registrationSignature], account: user }));
  const provisioned = await receipt(await wallet.writeContract(grant));
  assert.equal(await client.readContract({ address: space, abi: spaceAccountAbi, functionName: "consumedRequests", args: [permit.requestId] }), true);
  const state = await client.readContract({ address: registry, abi: ensRegistryAbi, functionName: "getState", args: [BigInt(labelhash("research"))] });
  const agentResolver = await client.readContract({ address: registry, abi: ensRegistryAbi, functionName: "getResolver", args: ["research"] });
  assert.equal(await client.readContract({ address: agentResolver, abi: ensResolverAbi, functionName: "addr", args: [namehash(`research.${label}.${parentName}`)] }), agent);
  assert.equal(await client.readContract({ address: adapter, abi: hierarchicalEnsPermissionAdapterAbi, functionName: "isAuthorized", args: [registry, BigInt(labelhash("research")), state.resource, agent] }), true);
  await receipt(await wallet.writeContract(provision)); // retry is idempotent
  await receipt(await wallet.writeContract({ address: registry, abi: ensRegistryAbi, functionName: "unregister", args: [BigInt(labelhash("research"))] }));
  await assert.rejects(client.simulateContract({ ...provision, account }));
  assert.equal(await client.readContract({ address: adapter, abi: hierarchicalEnsPermissionAdapterAbi, functionName: "isAuthorized", args: [registry, BigInt(labelhash("research")), state.resource, agent] }), false);
  console.log(`PASS Agent resolver + registration + mandate: one signature, one transaction (${provisioned.gasUsed} gas); unauthorized caller, retry and revocation checked`);

  phase = "fork: legacy atomic execution";
  async function legacyBatch(amount: bigint, id: bigint) {
    const planned = await funding(amount, id), firstNonce = await nonce();
    const calls = [];
    for (const [index, call] of planned.args[1].entries()) {
      const message = { from: user.address, ...call, value: 0n, nonce: firstNonce + BigInt(index), deadline: planned.args[2] };
      const signature = await user.signTypedData({ domain: { name: "AccordForwarder", version: "1", chainId: chain.id, verifyingContract: forwarder },
        types: forwardRequestTypes, primaryType: "ForwardRequest", message });
      calls.push({ target: forwarder, allowFailure: false, callData: encodeFunctionData({ abi: accordForwarderAbi, functionName: "execute", args: [{ ...message, signature }] }) });
    }
    return { address: sepolia.contracts.multicall3.address, abi: multicall3Abi, functionName: "aggregate3", args: [calls] } as const;
  }
  await receipt(await wallet.writeContract(await legacyBatch(20_000_000n, 2n)));
  const before = await nonce();
  const legacyFailed = await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ ...await legacyBatch(1_001_000_000n, 3n), gas: 3_000_000n }) });
  assert.equal(legacyFailed.status, "reverted");
  assert.equal(await nonce(), before);
  assert.equal(await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [space] }), 120_000_000n);
  assert.equal(await client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [user.address, space] }), 0n);
  console.log("PASS Legacy individual signatures through canonical Multicall3: one atomic transaction, rollback checked");

}

async function main() {
  if (fork) {
    for (let i = 0; i < 60; ++i) { try { await client.getChainId(); break; } catch { await delay(500); } }
    await client.request({ method: "anvil_setBalance" as never, params: [account.address, "0x56BC75E2D63100000"] as never });
  }
  assert.equal(await client.getChainId(), chain.id);
  console.log(JSON.stringify({ mode: fork ? "local-fork-test" : broadcast ? "broadcast" : "dry-run", operator: account.address,
    balanceWei: String(await client.getBalance({ address: account.address })), namespace: parentName }));
  if (!fork && !broadcast) return;
  if (state.chainId) assert.equal(state.chainId, String(chain.id));
  if (state.operator) assert.equal(getAddress(state.operator), account.address);
  state.chainId = String(chain.id); state.operator = account.address;
  const forwarder = await deploy("AccordForwarder");
  const token = await deploy("AccordTestUSDC", [forwarder]);
  const namespace = await deploy("SpaceNamespace", [account.address, forwarder, ENS_ROOT_REGISTRY, parent, parentLabel, namehash(parentName), ensFactoryAbiAddress, ensRegistryAbiAddress, ensResolverAbiAddress]);
  const adapter = await client.readContract({ address: namespace, abi: spaceNamespaceAbi, functionName: "adapter" });
  state.HierarchicalEnsPermissionAdapter = adapter;
  const factory = await deploy("NamedSpaceFactory", [forwarder, namespace]);
  phase = "configure namespace factory";
  const configuredFactory = await client.readContract({ address: namespace, abi: spaceNamespaceAbi, functionName: "factory" });
  if (configuredFactory === zeroAddress) await deploymentStep("setFactoryTx", () => wallet.writeContract({ address: namespace, abi: spaceNamespaceAbi, functionName: "setFactory", args: [factory] }));
  else assert.equal(configuredFactory, factory);
  phase = "grant registrar roles";
  const roles = await client.readContract({ address: parent, abi: ensRegistryAbi, functionName: "hasRootRoles", args: [ENS_ROOT_ROLES, namespace] });
  if (!roles) {
    if (fork) {
      await client.request({ method: "anvil_impersonateAccount" as never, params: [liveOperator] as never });
      await client.request({ method: "anvil_setBalance" as never, params: [liveOperator, "0x56BC75E2D63100000"] as never });
      await receipt(await createWalletClient({ account: liveOperator, chain, transport }).writeContract({ address: parent, abi: ensRegistryAbi, functionName: "grantRootRoles", args: [ENS_ROOT_ROLES, namespace] }));
    } else await deploymentStep("grantRolesTx", () => wallet.writeContract({ address: parent, abi: ensRegistryAbi, functionName: "grantRootRoles", args: [ENS_ROOT_ROLES, namespace] }));
  }
  assert.equal(await client.readContract({ address: adapter, abi: hierarchicalEnsPermissionAdapterAbi, functionName: "namespaceActive", args: [parent] }), true);
  state.completedAt = new Date().toISOString(); await save();
  if (fork) await forkChecks(forwarder, token, namespace, factory, adapter);
  if (activate) {
    phase = "activate environment";
    const envUrl = new URL("../../../.env", import.meta.url);
    const backupDir = new URL(`../../../.data/before-batching-${Date.now()}/`, import.meta.url);
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    await copyFile(envUrl, new URL(".env", backupDir));
    let env = await readFile(envUrl, "utf8");
    const values: Record<string, string> = { FORWARDER_ADDRESS: forwarder, DEMO_TOKEN_ADDRESS: token, SPACE_FACTORY_ADDRESS: factory, ENS_ADAPTER_ADDRESS: adapter, SPACE_NAMESPACE_ADDRESS: namespace };
    for (const [name, value] of Object.entries(values)) {
      const previous = process.env[name];
      if (previous && previous.toLowerCase() !== value.toLowerCase() && name !== "SPACE_NAMESPACE_ADDRESS") values[`LEGACY_${name}`] = [...new Set([...(process.env[`LEGACY_${name}`] ?? "").split(",").filter(Boolean), previous])].join(",");
    }
    for (const [name, value] of Object.entries(values)) {
      const pattern = new RegExp(`^${name}=.*$`, "m");
      env = pattern.test(env) ? env.replace(pattern, `${name}=${value}`) : `${env.trimEnd()}\n${name}=${value}\n`;
    }
    await writeFile(envUrl, env, { mode: 0o600 });
    console.log("Environment updated; previous deployment addresses remain allowlisted. Restart the API after deploying the web build.");
  }
}
try { await main(); }
catch (error) { console.error(`Batching ${phase} failed (${error instanceof Error ? error.name : "unknown error"}).`); if (fork && error instanceof Error) {
  console.error("shortMessage" in error ? error.shortMessage : error.message);
  let cause: any = error;
  while (cause) { if (cause.data?.errorName) console.error(JSON.stringify(cause.data, (_, value) => typeof value === "bigint" ? value.toString() : value)); cause = cause.cause; }
} process.exitCode = 1; }
finally { anvil?.kill("SIGTERM"); }
