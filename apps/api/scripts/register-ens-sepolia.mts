/** Register a real ENSv2 .eth name for the Sepolia agent demo. */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPublicClient, createWalletClient, erc20Abi, http, parseAbi,
  zeroAddress, zeroHash, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { labelhash } from "viem/ens";

// The current ENSv2 Beta contracts listed in https://docs.ens.domains/learn/deployments/.
const registrar = "0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca";
const registry = "0x657ea849311d3d5823348dded7c2aaafb3ede09e";
const mockUsdc = "0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e";
const label = process.env.ENS_DEMO_LABEL ?? "accordtokyodemo26";
const duration = 31_536_000n;
const broadcast = process.argv.includes("--broadcast");
const rpc = process.env.SEPOLIA_RPC_URL;
const key = process.env.DEPLOYER_PRIVATE_KEY;
const stateUrl = new URL("../../../.codex/accord-ens-demo.json", import.meta.url);

const registrarAbi = parseAbi([
  "function ETH_REGISTRY() view returns (address)",
  "function MIN_COMMITMENT_AGE() view returns (uint64)",
  "function isAvailable(string label) view returns (bool)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)",
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
  "function commitmentAt(bytes32 commitment) view returns (uint64)",
  "function commit(bytes32 commitment)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
]);
const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);
const registryAbi = [{
  type: "function", name: "getState", stateMutability: "view",
  inputs: [{ name: "anyId", type: "uint256" }],
  outputs: [{ name: "state", type: "tuple", components: [
    { name: "status", type: "uint8" }, { name: "expiry", type: "uint64" },
    { name: "latestOwner", type: "address" }, { name: "tokenId", type: "uint256" },
    { name: "resource", type: "uint256" },
  ] }],
}] as const;
const adapterAbi = parseAbi([
  "function isAuthorized(address registry, uint256 nameId, uint256 expectedResource, address actor) view returns (bool)",
]);

if (!rpc || !/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) {
  throw new Error("Set SEPOLIA_RPC_URL and a dedicated DEPLOYER_PRIVATE_KEY in the root .env");
}
if (!/^[a-z0-9-]{5,63}$/.test(label)) throw new Error("ENS_DEMO_LABEL must be a 5–63 character lowercase .eth label");

const account = privateKeyToAccount(key as Hex);
const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
const nameId = BigInt(labelhash(label));

async function confirmed(hash: Hex, action: string) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${action} reverted: ${hash}`);
  console.log(`${action}: ${hash}`);
  return receipt;
}

async function main() {
  if (await publicClient.getChainId() !== sepolia.id) throw new Error("RPC is not Ethereum Sepolia");
  const actualRegistry = await publicClient.readContract({ address: registrar, abi: registrarAbi, functionName: "ETH_REGISTRY" });
  if (actualRegistry.toLowerCase() !== registry) throw new Error("Registrar does not point at the configured ENSv2 registry");
  const state = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "getState", args: [nameId] });
  console.log(`Name: ${label}.eth`);
  console.log(`Registrar: ${registrar}; Registry: ${registry}`);
  console.log(`Agent/owner: ${account.address}`);
  const agentKey = process.env.DEMO_AGENT_PRIVATE_KEY;
  const demoAgent = /^0x[0-9a-fA-F]{64}$/.test(agentKey ?? "")
    ? privateKeyToAccount(agentKey as Hex).address : undefined;
  const currentOwner = state.latestOwner.toLowerCase();
  if (state.status === 2 && (currentOwner === account.address.toLowerCase() ||
    currentOwner === demoAgent?.toLowerCase())) {
    const adapter = process.env.ENS_ADAPTER_ADDRESS;
    if (adapter) {
      const authorized = await publicClient.readContract({ address: adapter as Hex, abi: adapterAbi,
        functionName: "isAuthorized", args: [registry, nameId, state.resource, state.latestOwner] });
      if (!authorized) throw new Error("Existing ENSv2 name is not accepted by Accord's adapter");
    }
    console.log(`Already registered to ${state.latestOwner}; resource: ${state.resource}`);
    return;
  }
  if (!await publicClient.readContract({ address: registrar, abi: registrarAbi, functionName: "isAvailable", args: [label] })) {
    throw new Error("The chosen ENSv2 name is unavailable");
  }
  const [base, premium] = await publicClient.readContract({ address: registrar, abi: registrarAbi,
    functionName: "getRegisterPrice", args: [label, duration, mockUsdc] });
  const price = base + premium;
  console.log(`Registration fee: ${price} MockUSDC atomic units`);
  if (!broadcast) { console.log("Dry run complete. Use --broadcast to mint MockUSDC, commit, and register."); return; }

  const balance = await publicClient.readContract({ address: mockUsdc, abi: erc20Abi,
    functionName: "balanceOf", args: [account.address] });
  if (balance < price) {
    const hash = await walletClient.writeContract({ address: mockUsdc, abi: mintAbi,
      functionName: "mint", args: [account.address, price + 10_000_000n - balance] });
    await confirmed(hash, "MockUSDC mint");
  }
  const allowance = await publicClient.readContract({ address: mockUsdc, abi: erc20Abi,
    functionName: "allowance", args: [account.address, registrar] });
  if (allowance < price) {
    const hash = await walletClient.writeContract({ address: mockUsdc, abi: erc20Abi,
      functionName: "approve", args: [registrar, price] });
    await confirmed(hash, "MockUSDC approval");
  }

  const secret = `0x${randomBytes(32).toString("hex")}` as Hex;
  const commitment = await publicClient.readContract({ address: registrar, abi: registrarAbi,
    functionName: "makeCommitment",
    args: [label, account.address, secret, zeroAddress, zeroAddress, duration, zeroHash] });
  const commitTx = await walletClient.writeContract({ address: registrar, abi: registrarAbi,
    functionName: "commit", args: [commitment] });
  await confirmed(commitTx, "ENSv2 commitment");
  const minimumAge = await publicClient.readContract({ address: registrar, abi: registrarAbi,
    functionName: "MIN_COMMITMENT_AGE" });
  const committedAt = await publicClient.readContract({ address: registrar, abi: registrarAbi,
    functionName: "commitmentAt", args: [commitment] });
  while ((await publicClient.getBlock()).timestamp < committedAt + minimumAge) await delay(5_000);

  const args = [label, account.address, secret, zeroAddress, zeroAddress, duration, mockUsdc, zeroHash] as const;
  await publicClient.simulateContract({ address: registrar, abi: registrarAbi,
    functionName: "register", args, account: account.address });
  const registerTx = await walletClient.writeContract({ address: registrar, abi: registrarAbi,
    functionName: "register", args });
  await confirmed(registerTx, "ENSv2 registration");
  const registered = await publicClient.readContract({ address: registry, abi: registryAbi,
    functionName: "getState", args: [nameId] });
  const adapter = process.env.ENS_ADAPTER_ADDRESS;
  const authorized = adapter && await publicClient.readContract({ address: adapter as Hex, abi: adapterAbi,
    functionName: "isAuthorized", args: [registry, nameId, registered.resource, account.address] });
  if (registered.status !== 2 || registered.latestOwner.toLowerCase() !== account.address.toLowerCase() ||
    registered.resource === 0n || authorized !== true) throw new Error("ENSv2 registration did not authorize the demo agent");
  await mkdir(new URL("../../../.codex/", import.meta.url), { recursive: true });
  await writeFile(stateUrl, JSON.stringify({
    name: `${label}.eth`, owner: account.address, registry, registrar,
    nameId: nameId.toString(), resource: registered.resource.toString(),
    expiry: registered.expiry.toString(), commitTx, registerTx,
  }, null, 2) + "\n", { mode: 0o600 });
  console.log(`Registered ${label}.eth with resource ${registered.resource}; Accord adapter authorizes the agent.`);
}

await main();
