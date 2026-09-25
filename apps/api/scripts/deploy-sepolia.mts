import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  getContractAddress,
  http,
  isHex,
  keccak256,
  type Abi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const EXPECTED_CHAIN_ID = 11_155_111;
const GAS_BUFFER_PERCENT = 20n;

type Artifact = {
  abi: Abi;
  bytecode: Hex;
};

type Deployment = {
  address: `0x${string}`;
  transactionHash: `0x${string}`;
};

function usage(): string {
  return [
    "Usage: pnpm deploy:sepolia [--dry-run | --broadcast]",
    "",
    "The default is --dry-run. --broadcast sends transactions to Sepolia and requires:",
    "  SEPOLIA_RPC_URL       Sepolia JSON-RPC endpoint",
    "  DEPLOYER_PRIVATE_KEY  Dedicated, test-only deployer key (0x + 64 hex chars)",
  ].join("\n");
}

function parseMode(args: string[]): "dry-run" | "broadcast" {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    process.exit(0);
  }

  const unknown = args.filter((arg) => arg !== "--dry-run" && arg !== "--broadcast");
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(", ")}\n\n${usage()}`);
  }
  if (args.includes("--dry-run") && args.includes("--broadcast")) {
    throw new Error("Choose either --dry-run or --broadcast, not both.");
  }
  return args.includes("--broadcast") ? "broadcast" : "dry-run";
}

async function loadArtifact(relativePath: string): Promise<Artifact> {
  const artifactUrl = new URL(relativePath, import.meta.url);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(artifactUrl, "utf8"));
  } catch {
    throw new Error(
      `Could not read ${artifactUrl.pathname}. Run \"forge build --root contracts\" first.`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Invalid Foundry artifact: ${artifactUrl.pathname}`);
  }
  const candidate = parsed as { abi?: unknown; bytecode?: { object?: unknown } };
  const bytecode = candidate.bytecode?.object;
  if (!Array.isArray(candidate.abi) || typeof bytecode !== "string" || !isHex(bytecode)) {
    throw new Error(`Artifact is missing a valid ABI or bytecode: ${artifactUrl.pathname}`);
  }
  if (bytecode === "0x" || bytecode.includes("__$")) {
    throw new Error(`Artifact has empty or unlinked bytecode: ${artifactUrl.pathname}`);
  }
  return { abi: candidate.abi as Abi, bytecode };
}

function buffered(value: bigint): bigint {
  return (value * (100n + GAS_BUFFER_PERCENT) + 99n) / 100n;
}

const mode = parseMode(process.argv.slice(2));
const rpcUrl = process.env.SEPOLIA_RPC_URL;
const privateKeyValue = process.env.DEPLOYER_PRIVATE_KEY;
const secrets = [rpcUrl, privateKeyValue].filter((value): value is string => Boolean(value));

function redact(value: unknown): string {
  return secrets.reduce(
    (message, secret) => message.replaceAll(secret, "[REDACTED]"),
    value instanceof Error ? value.message : String(value),
  );
}

async function main(): Promise<void> {
  if (!rpcUrl) {
    throw new Error("SEPOLIA_RPC_URL is required, including for dry-run network verification.");
  }

  const [adapter, factory, demoToken] = await Promise.all([
    loadArtifact("../../../contracts/out/EnsPermissionAdapter.sol/EnsPermissionAdapter.json"),
    loadArtifact("../../../contracts/out/SpaceFactory.sol/SpaceFactory.json"),
    loadArtifact("../../../contracts/out/AccordDemoToken.sol/AccordDemoToken.json"),
  ]);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const chainId = await publicClient.getChainId();
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `SEPOLIA_RPC_URL returned chain ID ${chainId}; expected Sepolia (${EXPECTED_CHAIN_ID}).`,
    );
  }

  console.log(`Mode: ${mode}`);
  console.log(`Network: Sepolia (${chainId})`);
  console.log(`EnsPermissionAdapter bytecode hash: ${keccak256(adapter.bytecode)}`);
  console.log(`SpaceFactory bytecode hash: ${keccak256(factory.bytecode)}`);
  console.log(`AccordDemoToken bytecode hash: ${keccak256(demoToken.bytecode)}`);

  if (!privateKeyValue) {
    if (mode === "broadcast") {
      throw new Error(
        "DEPLOYER_PRIVATE_KEY is required for --broadcast. Use a dedicated, test-only Sepolia key.",
      );
    }
    console.log("Dry-run complete. Set DEPLOYER_PRIVATE_KEY to also check the deployer, funds, gas, and predicted addresses.");
    return;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKeyValue)) {
    throw new Error("DEPLOYER_PRIVATE_KEY must be 0x followed by exactly 64 hexadecimal characters.");
  }

  const account = privateKeyToAccount(privateKeyValue as Hex);
  const [balance, nonce, fees, adapterGas, factoryGas, tokenGas] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
    publicClient.estimateFeesPerGas(),
    publicClient.estimateGas({ data: adapter.bytecode }),
    publicClient.estimateGas({ data: factory.bytecode }),
    publicClient.estimateGas({ data: demoToken.bytecode }),
  ]);
  const adapterGasLimit = buffered(adapterGas);
  const factoryGasLimit = buffered(factoryGas);
  const tokenGasLimit = buffered(tokenGas);
  const requiredBalance = (adapterGasLimit + factoryGasLimit + tokenGasLimit) * fees.maxFeePerGas;
  const predictedAdapter = getContractAddress({ from: account.address, nonce: BigInt(nonce) });
  const predictedFactory = getContractAddress({ from: account.address, nonce: BigInt(nonce + 1) });
  const predictedToken = getContractAddress({ from: account.address, nonce: BigInt(nonce + 2) });

  console.log(`Deployer: ${account.address}`);
  console.log(`Balance: ${formatEther(balance)} ETH`);
  console.log(`Estimated maximum deployment cost: ${formatEther(requiredBalance)} ETH`);
  console.log(`Predicted EnsPermissionAdapter address: ${predictedAdapter}`);
  console.log(`Predicted SpaceFactory address: ${predictedFactory}`);
  console.log(`Predicted AccordDemoToken address: ${predictedToken}`);

  if (balance < requiredBalance) {
    throw new Error(
      `Insufficient Sepolia ETH: deployer has ${formatEther(balance)} ETH; approximately ${formatEther(requiredBalance)} ETH is required with a ${GAS_BUFFER_PERCENT}% gas buffer.`,
    );
  }
  if (mode === "dry-run") {
    console.log("Dry-run checks passed. No transactions were sent.");
    return;
  }

  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });

  async function deploy(name: string, artifact: Artifact, gas: bigint): Promise<Deployment> {
    const transactionHash = await walletClient.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode,
      gas,
    });
    console.log(`${name} transaction: ${transactionHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
    if (receipt.status !== "success" || !receipt.contractAddress) {
      throw new Error(`${name} deployment failed in transaction ${transactionHash}.`);
    }
    console.log(`${name} address: ${receipt.contractAddress}`);
    return { address: receipt.contractAddress, transactionHash };
  }

  const ensPermissionAdapter = await deploy("EnsPermissionAdapter", adapter, adapterGasLimit);
  const spaceFactory = await deploy("SpaceFactory", factory, factoryGasLimit);
  const accordDemoToken = await deploy("AccordDemoToken", demoToken, tokenGasLimit);
  console.log(JSON.stringify({ chainId, deployer: account.address, ensPermissionAdapter, spaceFactory, accordDemoToken }, null, 2));
}

main().catch((error: unknown) => {
  console.error(`Sepolia deployment failed: ${redact(error)}`);
  process.exitCode = 1;
});
