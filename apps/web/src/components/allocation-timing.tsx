"use client";

import { allocationWindow, spaceAccountAbi, type AllocationSchedule, type AllocationState } from "@accord/chain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { formatUnits, getAddress } from "viem";
import { usePublicClient } from "wagmi";

export function useClaimAvailability(spaceAddress: string | undefined, allocationId: string) {
  const chain = usePublicClient({ chainId: 11155111 });
  const cache = useQueryClient();
  const queryKey = ["claim-availability", spaceAddress, allocationId];
  return useQuery({
    queryKey,
    enabled: !!chain && !!spaceAddress && /^[1-9][0-9]{0,77}$/.test(allocationId),
    retry: false,
    refetchInterval: (query) => query.state.data?.allocation[5] === 3 && !query.state.data.window.expired ? 8_000 : false,
    queryFn: async () => {
      const address = getAddress(spaceAddress!);
      const block = await chain!.getBlock();
      const allocation = await chain!.readContract({ address, abi: spaceAccountAbi, functionName: "allocations", args: [BigInt(allocationId)], blockNumber: block.number });
      const schedule = allocation[5] === 3 ? await chain!.readContract({ address, abi: spaceAccountAbi, functionName: "allocationSchedules", args: [BigInt(allocationId)], blockNumber: block.number }) : undefined;
      const previous = cache.getQueryData<{ blockTimestamp: bigint; observedAt: number }>(queryKey);
      const observedAt = previous?.blockTimestamp === block.timestamp ? previous.observedAt : Date.now();
      return { allocation, schedule, blockTimestamp: block.timestamp, observedAt, window: allocationWindow(allocation, block.timestamp, schedule) };
    },
  });
}

export function AllocationTiming({ allocation, schedule, blockTimestamp, observedAt, decimals, symbol }: {
  allocation: AllocationState; schedule?: AllocationSchedule; blockTimestamp: bigint;
  observedAt: number; decimals?: number; symbol: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const window = allocationWindow(allocation, blockTimestamp, schedule);
  const ticking = allocation[5] === 3 && !window.expired && !window.closed;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  const projectedTime = Number(blockTimestamp) + Math.max(0, (now - observedAt) / 1000);
  const left = (timestamp: bigint) => Math.max(0, Math.ceil(Number(timestamp) - projectedTime));
  const countdown = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const amount = decimals === undefined ? `${window.available} base units` : `${formatUnits(window.available, decimals)} ${symbol}`;
  return <div className="allocation-timing">
    <strong>{window.closed ? "Allocation closed" : window.expired ? "Claim window ended" : `Available now: ${amount}`}</strong>
    {ticking && window.endsAt ? <span>{window.nextResetAt
      ? left(window.nextResetAt) > 0 ? `Next reset in ${countdown(left(window.nextResetAt))} · ` : "Waiting for the next confirmed block · "
      : "Final claim window · "}{left(window.endsAt) > 0 ? `Ends in ${countdown(left(window.endsAt))}` : "Confirming expiry…"}</span> : null}
    {allocation[5] === 3 && !window.closed ? <small>{window.expired ? "Unclaimed funds remain recoverable by the owner." : "Unused allowance does not carry over. Timing is enforced onchain."}</small> : null}
  </div>;
}
