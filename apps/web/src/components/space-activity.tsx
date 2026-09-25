"use client";

import type { AccordClient } from "@accord/sdk";
import { useInfiniteQuery } from "@tanstack/react-query";
import { formatUnits, zeroAddress } from "viem";
import { Button } from "./ui/button";

const labels = { AllocationCreated: "Allocation funded", AllocationFunded: "Funds added", Claimed: "Person claimed",
  MandateSet: "Agent mandate granted", MandateRevoked: "Agent mandate revoked", PaymentMade: "Agent paid", AllocationRecovered: "Owner recovered funds" };
export function SpaceActivity({ client, spaceAddress, decimals, symbol = "tokens" }: {
  client: AccordClient; spaceAddress: string; decimals?: number; symbol?: string;
}) {
  const activity = useInfiniteQuery({ queryKey: ["space-activity", spaceAddress],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.spaceActivity({ spaceAddress, ...(pageParam ? { beforeBlock: pageParam } : {}) }),
    getNextPageParam: (page) => page.nextBeforeBlock,
    staleTime: 30_000, retry: 1 });
  const events = activity.data?.pages.flatMap((page) => page.events) ?? [];
  return <section className="space-activity" aria-label="Space activity">
    <div className="space-activity__heading"><div><h4>Activity & receipts</h4><p>Confirmed actions from this Space’s contract. Blocked requests do not appear onchain.</p></div><Button variant="outline" onClick={() => void activity.refetch()} disabled={activity.isFetching}>Refresh activity</Button></div>
    {activity.isPending ? <p role="status">Reading transaction history…</p> : null}
    {activity.isError ? <p role="status">Activity is temporarily unavailable. Refresh to try again; your funds and permissions are unchanged.</p> : null}
    {!activity.isPending && !activity.isError && events.length === 0 ? <p>No events in the loaded block range.{activity.hasNextPage ? " Load older activity to look further back." : " New confirmed actions will appear here."}</p> : null}
    <ol className="space-activity__list">{events.map((event) => <li key={event.id}>
      <div><strong>{labels[event.kind]}</strong><span>Allocation {event.allocationId}{event.actor && event.actor !== zeroAddress ? ` · ${event.actor.slice(0, 6)}…${event.actor.slice(-4)}` : ""}</span>{event.recipient ? <span>To {event.recipient.slice(0, 6)}…{event.recipient.slice(-4)}</span> : null}</div>
      <div>{event.amount !== undefined ? <strong>{decimals === undefined ? `${event.amount} base units` : `${formatUnits(BigInt(event.amount), decimals)} ${symbol}`}</strong> : null}<span>Block {event.blockNumber}</span>{process.env.NEXT_PUBLIC_ACCORD_LOCAL_E2E !== "1" ? <a href={`https://sepolia.etherscan.io/tx/${event.transactionHash}`} target="_blank" rel="noreferrer">View receipt</a> : <span title={event.transactionHash}>Local receipt {event.transactionHash.slice(0, 10)}…</span>}</div>
    </li>)}</ol>
    {activity.hasNextPage ? <Button variant="outline" disabled={activity.isFetching} onClick={() => void activity.fetchNextPage()}>{activity.isFetchingNextPage ? "Loading older actions…" : "Load older activity"}</Button> : null}
    {activity.data ? <p className="space-activity__range">Blocks {activity.data.pages.at(-1)!.fromBlock}–{activity.data.pages[0]!.toBlock}{!activity.hasNextPage ? " · history reaches Space deployment" : " · older blocks available"}</p> : null}
  </section>;
}
