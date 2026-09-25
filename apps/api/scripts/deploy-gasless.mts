import { readFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, encodeDeployData, formatEther, getAddress, getContractAddress,
  http, isAddress, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const rpc = process.env.SEPOLIA_RPC_URL;
const key = process.env.DEPLOYER_PRIVATE_KEY;
const adapter = process.env.ENS_ADAPTER_ADDRESS;
const broadcast = process.argv.includes("--broadcast");
if (!rpc || !key || !/^0x[a-fA-F0-9]{64}$/.test(key) || !adapter || !isAddress(adapter)) {
  throw new Error("Set SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, and ENS_ADAPTER_ADDRESS.");
}

type Artifact = { abi: Abi; bytecode: Hex };
async function artifact(name: string): Promise<Artifact> {
  const file = new URL(`../../../contracts/out/${name}.sol/${name}.json`, import.meta.url);
  const value = JSON.parse(await readFile(file, "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: value.abi, bytecode: value.bytecode.object };
}

const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
const account = privateKeyToAccount(key as Hex);
const wallet = createWalletClient({ chain: sepolia, account, transport: http(rpc) });
const [forwarder, factory, token, chainId, balance, nonce, fees] = await Promise.all([
  artifact("AccordForwarder"), artifact("SpaceFactory"), artifact("AccordTestUSDC"),
  publicClient.getChainId(), publicClient.getBalance({ address: account.address }),
  publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
  publicClient.estimateFeesPerGas(),
]);
if (chainId !== sepolia.id) throw new Error("RPC is not Sepolia");
const forwarderAddress = getContractAddress({ from: account.address, nonce: BigInt(nonce) });
const factoryAddress = getContractAddress({ from: account.address, nonce: BigInt(nonce + 1) });
const tokenAddress = getContractAddress({ from: account.address, nonce: BigInt(nonce + 2) });
const deployments = [
  { name: "AccordForwarder", artifact: forwarder, args: [] as readonly unknown[], address: forwarderAddress },
  { name: "SpaceFactory", artifact: factory, args: [forwarderAddress] as readonly unknown[], address: factoryAddress },
  { name: "AccordTestUSDC", artifact: token, args: [forwarderAddress] as readonly unknown[], address: tokenAddress },
];
let totalGas = BigInt(0);
const gasLimits: bigint[] = [];
for (const item of deployments) {
  const data = encodeDeployData({ abi: item.artifact.abi, bytecode: item.artifact.bytecode, args: item.args });
  const estimate = await publicClient.estimateGas({ account: account.address, data });
  const limit = estimate * BigInt(125) / BigInt(100);
  gasLimits.push(limit);
  totalGas += limit;
}
const maximumCost = totalGas * fees.maxFeePerGas;
console.log(JSON.stringify({ mode: broadcast ? "broadcast" : "dry-run", deployer: account.address,
  balance: formatEther(balance), maximumCost: formatEther(maximumCost),
  forwarderAddress, factoryAddress, tokenAddress, adapterAddress: getAddress(adapter) }, null, 2));
if (balance < maximumCost) throw new Error("Deployer needs more Sepolia ETH");
if (broadcast) {
  for (const [index, item] of deployments.entries()) {
    const hash = await wallet.deployContract({ abi: item.artifact.abi, bytecode: item.artifact.bytecode,
      args: item.args, gas: gasLimits[index]! });
    console.log(`${item.name} transaction: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success" || receipt.contractAddress?.toLowerCase() !== item.address.toLowerCase()) {
      throw new Error(`${item.name} did not deploy at the expected address`);
    }
    console.log(`${item.name} address: ${receipt.contractAddress}`);
  }
}
