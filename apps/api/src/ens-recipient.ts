import { getAddress, isAddress, zeroAddress, type Hex } from "viem";
import { normalize } from "viem/ens";
import { spaceAccountAbi } from "@accord/chain";
import { publicClient } from "./chain";

// Sepolia's official proxy resolves through ENSv2, not the legacy registry.
// https://docs.ens.domains/learn/deployments/#sepolia-ensv2-beta
const sepoliaResolver = "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe";

export function normalizeRecipientName(input: string) {
  const name = normalize(input.trim());
  if (!name.endsWith(".eth") || name.length > 255) throw new Error("Use a Sepolia .eth name.");
  return name;
}

export async function resolveRecipientName(name: string, blockNumber?: bigint) {
  const normalized = normalizeRecipientName(name);
  const configured = process.env.ENSV2_UNIVERSAL_RESOLVER_ADDRESS ?? sepoliaResolver;
  if (!isAddress(configured)) throw new Error("ENSv2 Universal Resolver is not configured.");
  const block = blockNumber ?? await publicClient.getBlockNumber({ cacheTime: 0 });
  const recipient = await publicClient.getEnsAddress({ name: normalized,
    universalResolverAddress: getAddress(configured), blockNumber: block });
  return recipient && recipient !== zeroAddress
    ? { name: normalized, address: getAddress(recipient), blockNumber: block.toString(), chainId: 11155111 as const }
    : null;
}

export async function confirmedRecipientLabel(row: {
  spaceAddress: string; allocationId: string; requestId: string; beneficiary: string;
}, blockNumber: bigint) {
  const address = getAddress(row.spaceAddress);
  const [consumed, allocation, mandate] = await Promise.all([
    publicClient.readContract({ address, abi: spaceAccountAbi, functionName: "consumedRequests", args: [row.requestId as Hex], blockNumber }),
    publicClient.readContract({ address, abi: spaceAccountAbi, functionName: "allocations", args: [BigInt(row.allocationId)], blockNumber }),
    publicClient.readContract({ address, abi: spaceAccountAbi, functionName: "mandates", args: [BigInt(row.allocationId)], blockNumber }),
  ]);
  // Agent budgets have no beneficiary; their label belongs to the mandate's agent.
  const holder = allocation[0] === zeroAddress ? mandate[0] : allocation[0];
  return consumed && holder.toLowerCase() === row.beneficiary.toLowerCase();
}
