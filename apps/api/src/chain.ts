import { spaceAccountAbi, spaceFactoryAbi } from "@accord/chain";
import { createPublicClient, decodeEventLog, getAddress, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com", { timeout: 12_000 }),
});

// Activity reads old logs. Some public Sepolia RPCs silently return nothing for
// older blocks, so history can come from a separate RPC. Defaults to the main one.
export const historyClient = process.env.SEPOLIA_HISTORY_RPC_URL
  ? createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_HISTORY_RPC_URL, { timeout: 20_000 }) })
  : publicClient;

export function permitSigner() {
  const privateKey = process.env.PERMIT_SIGNER_PRIVATE_KEY;
  if (!privateKey || !/^0x[a-fA-F0-9]{64}$/.test(privateKey)) throw new Error("Permit signer is not configured");
  return privateKeyToAccount(privateKey as Hex);
}

export function factoryAddress() {
  const value = process.env.SPACE_FACTORY_ADDRESS;
  if (!value || !isAddress(value)) throw new Error("Space factory is not configured");
  return getAddress(value);
}

export function adapterAddress() {
  const value = process.env.ENS_ADAPTER_ADDRESS;
  if (!value || !isAddress(value)) throw new Error("ENS adapter is not configured");
  return getAddress(value);
}

export async function deployedSpaceFromReceipt(txHash: Hex, expectedOwner: Address) {
  const factories = [factoryAddress(), ...(process.env.SPACE_LEGACY_FACTORY_ADDRESSES ?? "").split(",")
    .map((value) => value.trim()).filter(Boolean).map((value) => getAddress(value))];
  const adapter = adapterAddress();
  const signer = permitSigner();
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error("Space deployment transaction reverted");
  // Smart wallets can call the factory through an executor or bundler. The
  // canonical factory's event binds the Space to its owner; the transaction's
  // top-level from/to do not. Verify the immutable configuration below as well.
  const created = receipt.logs.flatMap((log) => {
    if (!factories.some((factory) => log.address.toLowerCase() === factory.toLowerCase())) return [];
    try {
      const decoded = decodeEventLog({ abi: spaceFactoryAbi, eventName: "SpaceCreated", data: log.data, topics: log.topics });
      return [decoded.args];
    } catch { return []; }
  }).filter((args) => args.owner.toLowerCase() === expectedOwner.toLowerCase() &&
    args.authorizer.toLowerCase() === signer.address.toLowerCase());
  if (created.length !== 1) throw new Error("Expected one trusted SpaceCreated event");
  const space = getAddress(created[0]!.space);
  const [owner, authorizer, token, ensAdapter, code] = await Promise.all([
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "owner" }),
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "authorizer" }),
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "token" }),
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "ensAdapter" }),
    publicClient.getBytecode({ address: space }),
  ]);
  if (!code || owner.toLowerCase() !== expectedOwner.toLowerCase() ||
    authorizer.toLowerCase() !== signer.address.toLowerCase() ||
    token.toLowerCase() !== created[0]!.token.toLowerCase() ||
    ensAdapter.toLowerCase() !== adapter.toLowerCase()) throw new Error("Deployed Space configuration mismatch");
  return { space, token: getAddress(token), blockNumber: receipt.blockNumber };
}
