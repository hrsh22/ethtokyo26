/** Opt-in live smoke test. Uses a separate test wallet and preserves its private recovery state under .data. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createPublicClient, encodeFunctionData, erc20Abi, getAddress, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { accordForwarderAbi, namedSpaceFactoryAbi, spaceAccountAbi, forwardBatchTypes, forwardRequestTypes } from "@accord/chain";

if (!process.argv.includes("--broadcast")) { console.log("Pass --broadcast to create and fund a dedicated test Space on Sepolia."); process.exit(0); }
const base = process.env.BATCHING_SMOKE_API ?? "http://127.0.0.1:4000";
const directory = new URL("../../../.data/batching-smoke/", import.meta.url), stateUrl = new URL("state.json", directory);
await mkdir(directory, { recursive: true, mode: 0o700 });
let state: Record<string, string>;
try { state = JSON.parse(await readFile(stateUrl, "utf8")); } catch { state = { key: generatePrivateKey() }; }
async function save() { await writeFile(stateUrl, JSON.stringify(state, null, 2), { mode: 0o600 }); }
await save();
const signer = privateKeyToAccount(state.key as Hex);
const chain = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL), pollingInterval: 1000 });
let cookie = "";
async function post(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: process.env.WEB_ORIGIN!, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const nextCookie = response.headers.get("set-cookie"); if (nextCookie) cookie = nextCookie.split(";")[0]!;
  const value = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${value._tag ?? "error"}`);
  return value;
}
async function confirmed(hash: Hex) {
  const receipt = await chain.waitForTransactionReceipt({ hash, timeout: 180_000 });
  assert.equal(receipt.status, "success"); return receipt;
}
async function main() {
  const config = await (await fetch(`${base}/v1/config`)).json();
  assert.equal(config.namedSpaces, true, "Activate batching before this smoke test");
  const forwarder = getAddress(config.forwarderAddress), token = getAddress(config.demoTokenAddress), factory = getAddress(config.factoryAddress);
  const challenge = await post("/v1/auth/challenge", { address: signer.address });
  await post("/v1/auth/verify", { id: challenge.id, address: signer.address, signature: await signer.signMessage({ message: challenge.message }), client: "browser" });
  const domain = { name: "AccordForwarder", version: "1", chainId: 11155111, verifyingContract: forwarder } as const;
  async function send(calls: { to: Address; data: Hex; gas: bigint }[]) {
    const nonce = await chain.readContract({ address: forwarder, abi: accordForwarderAbi, functionName: "nonces", args: [signer.address] });
    const deadline = Math.floor(Date.now() / 1000) + 300;
    if (calls.length === 1) {
      const call = calls[0]!;
      const signature = await signer.signTypedData({ domain, types: forwardRequestTypes, primaryType: "ForwardRequest", message: { from: signer.address, ...call, value: 0n, nonce, deadline } });
      return (await post("/v1/sponsor/relay", { forwarder, from: signer.address, ...call, gas: String(call.gas), value: "0", nonce: String(nonce), deadline: String(deadline), signature })).transactionHash as Hex;
    }
    const signature = await signer.signTypedData({ domain, types: forwardBatchTypes, primaryType: "ForwardBatch", message: { from: signer.address, calls, nonce, deadline } });
    return (await post("/v1/sponsor/batch", { forwarder, from: signer.address, nonce: String(nonce), deadline: String(deadline), signature, calls: calls.map(call => ({ ...call, gas: String(call.gas) })) })).transactionHash as Hex;
  }
  if (!state.draftId) {
    const draft = await post("/v1/spaces/drafts", { name: "Batching verification", templateId: "recurring-support" });
    state.draftId = draft.id; await save();
  }
  if (!state.createTx) {
    const started = Date.now();
    state.createTx = await send([{ to: factory, gas: 7_500_000n, data: encodeFunctionData({ abi: namedSpaceFactoryAbi, functionName: "createNamedSpace", args: [getAddress(config.authorizerAddress), token, "Batching verification"] }) }]);
    await save(); await confirmed(state.createTx as Hex); state.creationMs = String(Date.now() - started); await save();
  } else await confirmed(state.createTx as Hex);
  const activated = await post("/v1/spaces/activate", { draftId: state.draftId, deploymentTx: state.createTx });
  const space = getAddress(activated.spaceAddress); state.space = space;
  assert.equal(await chain.readContract({ address: space, abi: spaceAccountAbi, functionName: "owner" }), signer.address);
  const names = await post("/v1/agents/identities", { draftId: state.draftId });
  assert.equal(names.active, true);
  state.name = names.namespace; await save();
  if (!state.faucetTx) {
    state.faucetTx = (await post("/v1/sponsor/faucet", {})).transactionHash; await save();
  }
  await confirmed(state.faucetTx as Hex);
  if (!state.fundTx) {
    state.fundingRequestKey ??= randomUUID(); await save();
    const funding = await post("/v1/admin/allocations", { draftId: state.draftId, requestKey: state.fundingRequestKey, beneficiary: signer.address, amount: "1000000", periodCap: "1000000", period: 0 });
    const started = Date.now();
    state.fundTx = await send([
      { to: token, gas: 150_000n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [space, 1_000_000n] }) },
      { to: space, gas: 1_500_000n, data: funding.calldata as Hex },
    ]);
    state.permitRequestId = funding.permit.requestId; await save();
    await confirmed(state.fundTx as Hex); state.fundingMs = String(Date.now() - started); await save();
  } else await confirmed(state.fundTx as Hex);
  assert.equal(await chain.readContract({ address: space, abi: spaceAccountAbi, functionName: "consumedRequests", args: [state.permitRequestId as Hex] }), true);
  assert.equal(await chain.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [space] }), 1_000_000n);
  assert.equal(await chain.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [signer.address, space] }), 0n);
  const evidence = { space, namespace: state.name, createTx: state.createTx, fundTx: state.fundTx,
    creationMs: Number(state.creationMs), fundingMs: Number(state.fundingMs), verifiedAt: new Date().toISOString() };
  await writeFile(new URL("../../../deployments/batching-smoke-sepolia.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
}
await main().catch(error => { console.error(error instanceof Error ? error.message : "Smoke test failed"); process.exitCode = 1; });
