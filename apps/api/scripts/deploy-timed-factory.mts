/** Upgrade only the factory. Existing Spaces, tokens, and ENS adapter stay intact. */
import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, formatEther, http, keccak256, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

async function main() {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Dedicated deployer is unavailable");
  const account = privateKeyToAccount(key as Hex);
  const transport = http(process.env.SEPOLIA_RPC_URL);
  const chain = createPublicClient({ chain: sepolia, transport });
  if (await chain.getChainId() !== sepolia.id) throw new Error("Sepolia only");
  const compiled = JSON.parse(await readFile(new URL("../../../contracts/out/SpaceFactory.sol/SpaceFactory.json", import.meta.url), "utf8")) as {
    abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex };
  };
  const output = new URL("../../../.codex/accord-timed-factory.json", import.meta.url);
  let prior: { transactionHash: Hex } | undefined;
  try { prior = JSON.parse(await readFile(output, "utf8")) as typeof prior; }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  if (prior) {
    const receipt = await chain.getTransactionReceipt({ hash: prior.transactionHash });
    const code = receipt.contractAddress ? await chain.getBytecode({ address: receipt.contractAddress }) : undefined;
    if (receipt.status !== "success" || !code || keccak256(code) !== keccak256(compiled.deployedBytecode.object)) {
      throw new Error("An earlier deployment is recorded; inspect its receipt before deploying another factory");
    }
    console.log(`Existing factory verified: ${receipt.contractAddress}. No new transaction submitted.`);
    return;
  }
  const [estimate, fees, balance] = await Promise.all([
    chain.estimateGas({ account, data: compiled.bytecode.object }), chain.estimateFeesPerGas(), chain.getBalance({ address: account.address }),
  ]);
  const gas = estimate * 120n / 100n;
  const maximumCost = gas * fees.maxFeePerGas;
  console.log(JSON.stringify({ deployer: account.address, balance: formatEther(balance), maximumCost: formatEther(maximumCost), gas: gas.toString() }));
  if (maximumCost > balance || maximumCost > 5000000000000000n) throw new Error("Deployment exceeds 0.005 Sepolia ETH limit or available balance");
  if (!process.argv.includes("--broadcast")) { console.log("Dry run passed; no transaction submitted."); return; }
  const wallet = createWalletClient({ account, chain: sepolia, transport });
  const hash = await wallet.deployContract({ abi: compiled.abi, bytecode: compiled.bytecode.object, gas, ...fees });
  // Persist the public hash before waiting, so a timeout never loses the receipt.
  await writeFile(output, JSON.stringify({ transactionHash: hash, previousFactory: process.env.SPACE_FACTORY_ADDRESS }, null, 2) + "\n");
  console.log(`Factory transaction: ${hash}`);
  const receipt = await chain.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Factory deployment did not succeed");
  const code = await chain.getBytecode({ address: receipt.contractAddress });
  if (!code || keccak256(code) !== keccak256(compiled.deployedBytecode.object)) throw new Error("Deployed bytecode mismatch");
  const result = { chainId: sepolia.id, address: receipt.contractAddress, transactionHash: hash,
    previousFactory: process.env.SPACE_FACTORY_ADDRESS, gasUsed: receipt.gasUsed.toString(),
    costEth: formatEther(receipt.gasUsed * receipt.effectiveGasPrice), bytecodeHash: keccak256(code) };
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
}
main().catch((error: unknown) => {
  // RPC library errors can embed environment values. Never print their full payload.
  console.error(error instanceof Error && "shortMessage" in error ? String(error.shortMessage) : error instanceof Error ? error.message.split("\n")[0] : "Deployment failed");
  process.exitCode = 1;
});
