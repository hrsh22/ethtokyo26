import { accordForwarderAbi, spaceAccountAbi, spaceFactoryAbi } from "@accord/chain";
import { createPublicClient, encodeFunctionData, erc20Abi, getAddress, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const base = process.env.API_URL ?? "http://127.0.0.1:4000";
const rpc = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const chain = createPublicClient({ chain: sepolia, transport: http(rpc) });
const user = privateKeyToAccount(generatePrivateKey());

async function request(path: string, payload: unknown, token?: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}${path}`, { method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload) });
  const body = await response.text();
  if (!response.ok || !body) throw new Error(`${path}: HTTP ${response.status} ${body.slice(0, 300)}`);
  return JSON.parse(body) as Record<string, unknown>;
}

async function mined(hash: Hex, label: string) {
  const receipt = await chain.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label}: ${hash}`);
  return receipt;
}

const config = await (await fetch(`${base}/v1/config`)).json() as Record<string, string>;
const forwarder = getAddress(config.forwarderAddress!);
const factory = getAddress(config.factoryAddress!);
const tokenAddress = getAddress(config.demoTokenAddress!);
const challenge = await request("/v1/auth/challenge", { address: user.address });
const session = await request("/v1/auth/verify", { id: challenge.id, address: user.address,
  signature: await user.signMessage({ message: String(challenge.message) }), client: "agent" });
const bearer = String(session.token);
console.log(`Disposable user: ${user.address}; starting ETH: ${await chain.getBalance({ address: user.address })}`);

const faucet = await request("/v1/sponsor/faucet", {}, bearer);
await mined(faucet.transactionHash as Hex, "Sponsored faucet");
const balance = await chain.readContract({ address: tokenAddress, abi: erc20Abi,
  functionName: "balanceOf", args: [user.address] });
if (balance !== BigInt(1_000_000_000)) throw new Error(`Wrong faucet balance: ${balance}`);

const draft = await request("/v1/spaces/drafts", { name: "Sponsored smoke test", templateId: "recurring-support" }, bearer);
async function relay(to: Address, data: Hex, gas: bigint, label: string) {
  const nonce = await chain.readContract({ address: forwarder, abi: accordForwarderAbi,
    functionName: "nonces", args: [user.address] });
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const signature = await user.signTypedData({
    domain: { name: "AccordForwarder", version: "1", chainId: sepolia.id, verifyingContract: forwarder },
    types: { ForwardRequest: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "value", type: "uint256" }, { name: "gas", type: "uint256" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" },
      { name: "data", type: "bytes" },
    ] }, primaryType: "ForwardRequest",
    message: { from: user.address, to, value: BigInt(0), gas, nonce, deadline, data },
  });
  const sent = await request("/v1/sponsor/relay", { from: user.address, to, value: "0", gas: String(gas),
    nonce: String(nonce), deadline: String(deadline), data, signature }, bearer);
  return mined(sent.transactionHash as Hex, label);
}

const deployment = await relay(factory, encodeFunctionData({ abi: spaceFactoryAbi, functionName: "createSpace",
  args: [getAddress(config.authorizerAddress!), tokenAddress, getAddress(config.adapterAddress!)] }),
BigInt(7_500_000), "Sponsored Space deployment");
const activated = await request("/v1/spaces/activate", { draftId: draft.id, deploymentTx: deployment.transactionHash }, bearer);
const space = getAddress(String(activated.spaceAddress));
const owner = await chain.readContract({ address: space, abi: spaceAccountAbi, functionName: "owner" });
if (owner.toLowerCase() !== user.address.toLowerCase()) throw new Error("Relayer became Space owner");

const allocation = await request("/v1/admin/allocations", { draftId: draft.id, requestKey: crypto.randomUUID(),
  beneficiary: user.address, amount: "1000000", periodCap: "1000000", period: 0 }, bearer);
await relay(tokenAddress, encodeFunctionData({ abi: erc20Abi, functionName: "approve",
  args: [space, BigInt(1_000_000)] }), BigInt(150_000), "Sponsored tUSDC approval");
await relay(space, allocation.calldata as Hex, BigInt(1_500_000), "Sponsored allocation funding");
const terms = await chain.readContract({ address: space, abi: spaceAccountAbi, functionName: "allocations", args: [BigInt(1)] });
if (terms[1] !== BigInt(1_000_000) || await chain.getBalance({ address: user.address }) !== BigInt(0)) {
  throw new Error("Funded allocation or zero-ETH user assertion failed");
}
console.log(`Gasless smoke passed: Space ${space}, user ETH 0, allocation 1 tUSDC`);
