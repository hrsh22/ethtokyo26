/** Add a real beneficiary wallet to the existing public Sepolia Space. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spaceAccountAbi } from "@accord/chain";
import {
  createPublicClient, createWalletClient, erc20Abi, getAddress, http, isAddress,
  parseAbi, parseEther, zeroAddress, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const api = process.env.API_URL ?? "http://127.0.0.1:4000";
const rpc = process.env.SEPOLIA_RPC_URL;
const token = process.env.DEMO_TOKEN_ADDRESS;
const key = process.env.DEPLOYER_PRIVATE_KEY;
const input = process.argv.slice(2).find((value) => isAddress(value)) ?? process.env.DEMO_BENEFICIARY_ADDRESS;
if (!rpc || !token || !isAddress(token) || !/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) {
  throw new Error("Configure SEPOLIA_RPC_URL, DEMO_TOKEN_ADDRESS and DEPLOYER_PRIVATE_KEY in the root .env");
}
if (!input || !isAddress(input) || getAddress(input) === zeroAddress) {
  throw new Error("Usage: pnpm --filter @accord/api demo:beneficiary -- 0x<beneficiary wallet address>");
}
const beneficiary = getAddress(input);
const owner = privateKeyToAccount(key as Hex);
const tokenAddress = getAddress(token);
const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ account: owner, chain: sepolia, transport: http(rpc) });
const amount = parseEther("5");
const demoUrl = new URL("../../../.codex/accord-sepolia-demo.json", import.meta.url);
const stateUrl = new URL("../../../.codex/accord-beneficiaries.json", import.meta.url);
const faucetAbi = parseAbi(["function faucet()"]);
type BeneficiaryState = { requestKey: string; allocationId?: string; requestId?: Hex; tx?: Hex };

async function confirmed(hash: Hex, label: string) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label}: ${hash}`);
}

async function post(path: string, body: object, token?: string) {
  const response = await fetch(`${api}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const value = await response.json() as Record<string, unknown>;
  if (response.status !== 200) throw new Error(`${path}: HTTP ${response.status}; ${JSON.stringify(value)}`);
  return value;
}

async function save(states: Record<string, BeneficiaryState>) {
  await mkdir(new URL("../../../.codex/", import.meta.url), { recursive: true });
  await writeFile(stateUrl, JSON.stringify(states, null, 2) + "\n", { mode: 0o600 });
}

if (await publicClient.getChainId() !== sepolia.id) throw new Error("RPC is not Ethereum Sepolia");
const demo = JSON.parse(await readFile(demoUrl, "utf8")) as { draftId?: string; spaceAddress?: Address };
if (!demo.draftId || !demo.spaceAddress) throw new Error("Run demo:sepolia first to activate the public Space");
const space = getAddress(demo.spaceAddress);
const [chainOwner, chainToken] = await Promise.all([
  publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "owner" }),
  publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "token" }),
]);
if (chainOwner !== owner.address || chainToken !== tokenAddress) throw new Error("Public Space does not match owner/token configuration");

let states: Record<string, BeneficiaryState>;
try { states = JSON.parse(await readFile(stateUrl, "utf8")) as Record<string, BeneficiaryState>; }
catch { states = {}; }
const stateKey = beneficiary.toLowerCase();
const state = states[stateKey] ?? { requestKey: randomUUID() };
states[stateKey] = state;
await save(states);

async function allocationExists() {
  if (!state.allocationId || !state.requestId) return false;
  const id = BigInt(state.allocationId);
  const [nextId, allocation, consumed] = await Promise.all([
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "nextAllocationId" }),
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "allocations", args: [id] }),
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "consumedRequests",
      args: [state.requestId] }),
  ]);
  if (id >= nextId) return false;
  if (allocation[0].toLowerCase() !== beneficiary.toLowerCase() || allocation[1] > amount ||
    allocation[2] !== amount || allocation[5] !== 0 || allocation[6] || !consumed) {
    throw new Error(`Allocation ${id} exists onchain but does not match this beneficiary request`);
  }
  return true;
}

if (state.tx) await confirmed(state.tx, "Beneficiary allocation");
if (!await allocationExists()) {
  const challenge = await post("/v1/auth/challenge", { address: owner.address });
  const signature = await owner.signMessage({ message: String(challenge.message) });
  const signedIn = await post("/v1/auth/verify", {
    id: challenge.id, address: owner.address, signature, client: "agent",
  });
  const envelope = await post("/v1/admin/allocations", {
    draftId: demo.draftId, requestKey: state.requestKey, beneficiary,
    amount: amount.toString(), periodCap: amount.toString(), period: 0,
  }, String(signedIn.token));
  const permit = envelope.permit as Record<string, unknown>;
  state.allocationId = String(permit.allocationId);
  state.requestId = String(permit.requestId) as Hex;
  await save(states);

  const balance = await publicClient.readContract({ address: tokenAddress, abi: erc20Abi,
    functionName: "balanceOf", args: [owner.address] });
  if (balance < amount) await confirmed(await wallet.writeContract({ address: tokenAddress,
    abi: faucetAbi, functionName: "faucet" }), "Demo-token faucet");
  const allowance = await publicClient.readContract({ address: tokenAddress, abi: erc20Abi,
    functionName: "allowance", args: [owner.address, space] });
  if (allowance < amount) await confirmed(await wallet.writeContract({ address: tokenAddress,
    abi: erc20Abi, functionName: "approve", args: [space, amount] }), "Approve beneficiary funding");

  const transaction = await publicClient.simulateContract({ account: owner, address: space,
    abi: spaceAccountAbi, functionName: "createAllocation",
    args: [beneficiary, amount, amount, 0, {
      actor: getAddress(String(permit.actor)), action: Number(permit.action) as 0,
      allocationId: BigInt(String(permit.allocationId)), recipient: getAddress(String(permit.recipient)),
      amount: BigInt(String(permit.amount)), requestId: String(permit.requestId) as Hex,
      nonce: BigInt(String(permit.nonce)), expiry: BigInt(String(permit.expiry)),
      policyVersion: BigInt(String(permit.policyVersion)), detailsHash: String(permit.detailsHash) as Hex,
    }, String(envelope.signature) as Hex],
  });
  const tx = await wallet.writeContract(transaction.request);
  state.tx = tx;
  await save(states);
  await confirmed(tx, "Beneficiary allocation");
}
if (!await allocationExists()) throw new Error("Beneficiary allocation did not appear onchain");
if (await publicClient.getBalance({ address: beneficiary }) < parseEther("0.001")) {
  await confirmed(await wallet.sendTransaction({ to: beneficiary, value: parseEther("0.002") }),
    "Fund beneficiary with Sepolia gas");
}
console.log(JSON.stringify({ beneficiary, space, allocationId: state.allocationId, amount: "5 ACD",
  ...(state.tx ? { allocationTx: state.tx } : {}) }, null, 2));
