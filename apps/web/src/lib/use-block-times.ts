"use client";

import { useQueries } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { SEPOLIA_CHAIN_ID } from "./accord";

/** Block timestamps for activity rows. Blocks never change, so each is fetched once. */
export function useBlockTimes(blocks: readonly string[]) {
  const chain = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const unique = [...new Set(blocks)];
  return useQueries({
    queries: unique.map((block) => ({
      queryKey: ["block-time", block],
      enabled: !!chain,
      staleTime: Infinity,
      retry: 1,
      queryFn: async () => Number((await chain!.getBlock({ blockNumber: BigInt(block) })).timestamp),
    })),
    combine: (results) => new Map(unique.map((block, index) => [block, results[index]?.data])),
  });
}
