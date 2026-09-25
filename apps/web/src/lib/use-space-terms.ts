"use client";

import { ensPermissionAdapterAbi, spaceAccountAbi } from "@accord/chain";
import { useQuery } from "@tanstack/react-query";
import { getAddress } from "viem";
import { sepolia } from "viem/chains";
import { usePublicClient } from "wagmi";

export function useSpaceTerms(spaceAddress?: string | null) {
  const publicClient = usePublicClient({ chainId: sepolia.id });
  return useQuery({
    queryKey: ["space-terms", spaceAddress],
    staleTime: 15_000,
    refetchInterval: 30_000,
    enabled: !!publicClient && !!spaceAddress,
    queryFn: async () => {
      const address = getAddress(spaceAddress!);
      const block = await publicClient!.getBlock();
      const [nextId, adapter] = await Promise.all([
        publicClient!.readContract({ address, abi: spaceAccountAbi, functionName: "nextAllocationId", blockNumber: block.number }),
        publicClient!.readContract({ address, abi: spaceAccountAbi, functionName: "ensAdapter", blockNumber: block.number }),
      ]);
      const lastId = nextId - BigInt(1);
      const firstId = lastId > BigInt(20) ? lastId - BigInt(19) : BigInt(1);
      const ids = lastId === BigInt(0) ? [] : Array.from({ length: Number(lastId - firstId + BigInt(1)) },
        (_, index) => firstId + BigInt(index));
      const allocations = await Promise.all(ids.map(async (id) => {
        const [allocation, mandate] = await Promise.all([
          publicClient!.readContract({ address, abi: spaceAccountAbi, functionName: "allocations", args: [id], blockNumber: block.number }),
          publicClient!.readContract({ address, abi: spaceAccountAbi, functionName: "mandates", args: [id], blockNumber: block.number }),
        ]);
        const ensAuthorized = mandate[9] && mandate[8] > block.timestamp
          ? await publicClient!.readContract({ address: adapter, abi: ensPermissionAdapterAbi,
            functionName: "isAuthorized", args: [mandate[1], mandate[2], mandate[3], mandate[0]], blockNumber: block.number })
          : false;
        return { id, allocation, mandate, ensAuthorized };
      }));
      return { count: lastId, allocations, blockTimestamp: block.timestamp };
    },
  });
}

export type SpaceAllocation = NonNullable<ReturnType<typeof useSpaceTerms>["data"]>["allocations"][number];
