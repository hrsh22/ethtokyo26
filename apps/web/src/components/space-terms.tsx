"use client";

import { ensPermissionAdapterAbi, spaceAccountAbi } from "@accord/chain";
import type { AccordClient } from "@accord/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatUnits, getAddress, zeroAddress, type Address } from "viem";
import { sepolia } from "viem/chains";
import { usePublicClient } from "wagmi";
import { AllocationTiming } from "./allocation-timing";

const periodLabels = ["No reset", "Daily", "Monthly", "Per window"] as const;
const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

export function SpaceTerms({ spaceAddress, decimals, account, client, symbol = "tokens" }: {
  spaceAddress: string; decimals?: number; account: string; symbol?: string; client?: AccordClient;
}) {
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const cache = useQueryClient();
  const terms = useQuery({
    queryKey: ["space-terms", spaceAddress],
    enabled: !!publicClient,
    refetchInterval: (query) => query.state.data?.allocations.some(({ allocation, schedule }) =>
      allocation[5] === 3 && !allocation[6] && schedule && schedule[1] > query.state.data!.blockTimestamp) ? 8_000 : false,
    queryFn: async () => {
      const address = getAddress(spaceAddress);
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
        const schedule = allocation[5] === 3 ? await publicClient!.readContract({ address, abi: spaceAccountAbi,
          functionName: "allocationSchedules", args: [id], blockNumber: block.number }) : undefined;
        return { id, allocation, mandate, ensAuthorized, schedule };
      }));
      const previous = cache.getQueryData<{ blockTimestamp: bigint; observedAt: number }>(["space-terms", spaceAddress]);
      const observedAt = previous?.blockTimestamp === block.timestamp ? previous.observedAt : Date.now();
      return { count: lastId, allocations, blockTimestamp: block.timestamp, observedAt };
    },
  });
  const allocationIds = terms.data?.allocations.map(({ id }) => id.toString()) ?? [];
  const names = useQuery({
    queryKey: ["allocation-names", spaceAddress, allocationIds],
    enabled: !!client && allocationIds.length > 0,
    queryFn: () => client!.allocationNames(spaceAddress, allocationIds),
    staleTime: 60_000, retry: false,
  });
  const units = (value: bigint) => decimals === undefined
    ? `${value.toString()} base units`
    : `${formatUnits(value, decimals)} ${symbol}`;

  return <section className="space-console__terms" aria-label="Current onchain allocations">
    <div className="space-console__terms-heading"><div><strong>Current allocations</strong><span>Read directly from this Space on Sepolia</span></div><div className="space-console__terms-actions">{terms.data && <small>{terms.data.count.toString()} total</small>}<button type="button" onClick={() => { void terms.refetch(); if (client && allocationIds.length) void names.refetch(); }} disabled={terms.isFetching}>Refresh</button></div></div>
    {terms.isPending ? <p className="space-console__terms-status">Reading onchain terms…</p>
      : terms.isError ? <p className="space-console__terms-status">Could not read this Space. Check the Sepolia RPC and try again.</p>
      : terms.data.allocations.length === 0 ? <p className="space-console__terms-status">No allocations have been added yet.</p>
      : <div className="space-console__terms-list">{terms.data.allocations.map(({ id, allocation, mandate, ensAuthorized, schedule }) => {
        const beneficiary = allocation[0] as Address;
        const agent = mandate[0] as Address;
        const isAgentBudget = beneficiary === zeroAddress;
        const name = names.data?.names.find((entry) => entry.allocationId === id.toString() && entry.address.toLowerCase() === beneficiary.toLowerCase());
        const yours = account !== zeroAddress && (isAgentBudget ? agent : beneficiary).toLowerCase() === account.toLowerCase();
        const mandateActive = mandate[9] && mandate[8] > terms.data.blockTimestamp;
        const agentCanPay = mandateActive && ensAuthorized;
        return <div className={`space-console__term${yours ? " is-yours" : ""}`} key={id.toString()}>
          <div className="space-console__term-top"><strong>Allocation {id.toString()}</strong><span>{allocation[6] ? "Closed" : schedule && schedule[1] <= terms.data.blockTimestamp ? "Expired" : isAgentBudget && agent !== zeroAddress && !agentCanPay ? "Inactive mandate" : yours ? "Your access" : isAgentBudget ? "Agent budget" : "Person"}</span></div>
          <p>{isAgentBudget ? agent !== zeroAddress ? `Agent ${shortAddress(agent)}` : "No agent mandate" : name ? name.name : `Beneficiary ${shortAddress(beneficiary)}`}</p>
          {!isAgentBudget && <><code className="beneficiary-address">{beneficiary}</code><small>{name ? "ENS name saved at setup · Wallet fixed · " : "Wallet fixed · "}World ID required for claims</small></>}
          <small>Remaining {units(allocation[1])} · {periodLabels[allocation[5]] ?? "Period"} cap {units(allocation[2])}</small>
          {schedule ? <><small>Every {schedule[2]} seconds · {Number(schedule[1] - schedule[0]) / 60} minutes from funding</small><AllocationTiming allocation={allocation} schedule={schedule} blockTimestamp={terms.data.blockTimestamp} observedAt={terms.data.observedAt} decimals={decimals} symbol={symbol} /></> : null}
          {agent !== zeroAddress && <small>Daily cap {units(mandate[4])} · Max payment {units(mandate[5])} · Expires {new Date(Number(mandate[8]) * 1000).toLocaleDateString()} · {agentCanPay ? "ENS authority active" : !mandateActive ? "Mandate inactive or expired" : "ENS authority unavailable"}</small>}
          <small>{allocation[6] ? "Closed; unspent funds returned to the owner." : "Owner may close this allocation and recover unspent funds."}</small>
        </div>;
      })}</div>}
    {terms.data && terms.data.count > BigInt(20) ? <p className="space-console__terms-status">Showing the newest 20 allocations. You can still use older allocation IDs for permitted actions.</p> : null}
  </section>;
}
