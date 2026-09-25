"use client";

import { allocationWindow, ensPermissionAdapterAbi, spaceAccountAbi } from "@accord/chain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAddress } from "viem";
import { usePublicClient } from "wagmi";
import { SEPOLIA_CHAIN_ID } from "./accord";

/** One allocation read at a single block, so its window, mandate and ENS state agree. */
export function useAllocation(spaceAddress: string, allocationId: bigint) {
  const chain = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const cache = useQueryClient();
  const queryKey = ["allocation", spaceAddress, allocationId.toString()];
  return useQuery({
    queryKey,
    enabled: !!chain,
    retry: 1,
    refetchInterval: (query) => query.state.data?.allocation[5] === 3 && !query.state.data.window.expired ? 8_000 : 30_000,
    queryFn: async () => {
      const address = getAddress(spaceAddress);
      const block = await chain!.getBlock();
      const at = { blockNumber: block.number };
      const [nextId, allocation, mandate, adapter] = await Promise.all([
        chain!.readContract({ address, abi: spaceAccountAbi, functionName: "nextAllocationId", ...at }),
        chain!.readContract({ address, abi: spaceAccountAbi, functionName: "allocations", args: [allocationId], ...at }),
        chain!.readContract({ address, abi: spaceAccountAbi, functionName: "mandates", args: [allocationId], ...at }),
        chain!.readContract({ address, abi: spaceAccountAbi, functionName: "ensAdapter", ...at }),
      ]);
      if (allocationId <= BigInt(0) || allocationId >= nextId) return null;
      const [schedule, ensAuthorized] = await Promise.all([
        allocation[5] === 3 ? chain!.readContract({ address, abi: spaceAccountAbi, functionName: "allocationSchedules", args: [allocationId], ...at }) : undefined,
        mandate[9] && mandate[8] > block.timestamp ? chain!.readContract({ address: adapter, abi: ensPermissionAdapterAbi,
          functionName: "isAuthorized", args: [mandate[1], mandate[2], mandate[3], mandate[0]], ...at }) : false,
      ]);
      const previous = cache.getQueryData<{ blockTimestamp: bigint; observedAt: number }>(queryKey);
      const observedAt = previous?.blockTimestamp === block.timestamp ? previous.observedAt : Date.now();
      return { id: allocationId, allocation, mandate, schedule, ensAuthorized, blockTimestamp: block.timestamp, observedAt,
        window: allocationWindow(allocation, block.timestamp, schedule) };
    },
  });
}

export type AllocationData = NonNullable<NonNullable<ReturnType<typeof useAllocation>["data"]>>;
