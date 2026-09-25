"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Ban, Fingerprint, History, PiggyBank, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { useAccord } from "@/lib/accord";
import { shortAddress, timeAgo } from "@/lib/format";
import { explorerTx } from "@/lib/use-chain-actions";
import { useBlockTimes } from "@/lib/use-block-times";
import { Button } from "../ui/button";

type Kind = "AllocationCreated" | "AllocationFunded" | "Claimed" | "MandateSet" | "MandateRevoked" | "PaymentMade" | "AllocationRecovered";
const look: Record<Kind, { icon: typeof Sparkles; bg: string; fg: string; sign: "" | "-" | "+" }> = {
  AllocationCreated: { icon: Sparkles, bg: "#EEFBD6", fg: "#4A7A00", sign: "" },
  AllocationFunded: { icon: PiggyBank, bg: "#EEFBD6", fg: "#4A7A00", sign: "" },
  Claimed: { icon: Fingerprint, bg: "#FFEBDD", fg: "#E2561C", sign: "-" },
  MandateSet: { icon: ShieldCheck, bg: "#EEE8FF", fg: "#6F4BEA", sign: "" },
  MandateRevoked: { icon: Ban, bg: "#FFE3E8", fg: "#D23651", sign: "" },
  PaymentMade: { icon: ArrowUpRight, bg: "#EEE8FF", fg: "#6F4BEA", sign: "-" },
  AllocationRecovered: { icon: RotateCcw, bg: "#E2F4FF", fg: "#2B7CC4", sign: "+" },
};

function sentence(kind: Kind, who: string, recipient?: string) {
  switch (kind) {
    case "AllocationCreated": return `${who} got a new budget`;
    case "AllocationFunded": return `Funds added for ${who}`;
    case "Claimed": return `${who} claimed`;
    case "MandateSet": return `Mandate granted to ${who}`;
    case "MandateRevoked": return `Mandate revoked for ${who}`;
    case "PaymentMade": return `${who} paid ${recipient ? shortAddress(recipient) : "a recipient"}`;
    case "AllocationRecovered": return `Closed ${who}, unspent funds returned`;
  }
}

/** Confirmed onchain actions, newest first. Refused requests never reach the chain, so they don't show here. */
export function ActivityFeed({ spaceAddress, units, nameOf, allocationId, title = "Activity", layout = "card" }: {
  spaceAddress: string; units: (value: bigint) => string; nameOf: (allocationId: string) => string; allocationId?: string; title?: string;
  layout?: "card" | "section";
}) {
  const { client } = useAccord();
  const activity = useInfiniteQuery({
    queryKey: ["space-activity", spaceAddress],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client!.spaceActivity({ spaceAddress, ...(pageParam ? { beforeBlock: pageParam } : {}) }),
    getNextPageParam: (page) => page.nextBeforeBlock,
    enabled: !!client,
    staleTime: 30_000,
    retry: 1,
  });
  const events = (activity.data?.pages.flatMap((page) => page.events) ?? []).filter((event) => !allocationId || event.allocationId === allocationId);
  // Each page covers 5,000 blocks. A quiet Space shouldn't look empty, so keep
  // paging back a little until something shows up or the history starts.
  const pages = activity.data?.pages.length ?? 0;
  const { hasNextPage, isFetching, fetchNextPage } = activity;
  useEffect(() => {
    if (events.length === 0 && hasNextPage && !isFetching && pages < 8) void fetchNextPage();
  }, [events.length, hasNextPage, isFetching, pages, fetchNextPage]);
  const times = useBlockTimes(events.map((event) => event.blockNumber));
  return <section className={layout === "card" ? "card p-6" : undefined} aria-labelledby={`${title}-heading`}>
    <div className={`flex items-center justify-between ${layout === "section" ? "mb-4" : "mb-2"}`}>
      <h2 id={`${title}-heading`} className={`font-display font-extrabold ${layout === "section" ? "text-3xl" : "text-2xl"}`}>{title}</h2>
      {activity.isFetching && !activity.isPending ? <span className="size-2 animate-ping rounded-full bg-lilac" aria-label="Refreshing" /> : null}
    </div>
    <div className={layout === "section" ? "card p-6" : undefined}>
    {activity.isPending || (events.length === 0 && activity.isFetchingNextPage) ? <div className="grid gap-3 pt-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-2xl bg-soft" />)}</div>
      : activity.isError ? <p role="status" className="py-3 text-sm text-muted">Activity is unavailable right now. Funds and permissions are unchanged.
        <button className="ml-1 font-semibold text-ink underline" onClick={() => void activity.refetch()}>Retry</button></p>
      : events.length === 0 ? <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-soft text-muted"><History size={20} /></span>
        <div className="min-w-0"><p className="font-semibold">No activity yet</p><p className="mt-1 text-sm text-muted">Budget updates, claims and payments will appear here.</p></div>
      </div>
      : <ul className="grid grid-cols-1">
        <AnimatePresence initial={false}>
          {events.map((event) => {
            const style = look[event.kind];
            const time = times.get(event.blockNumber);
            const who = nameOf(event.allocationId);
            const label = who.endsWith(".eth") ? who.split(".")[0] : who;
            const link = explorerTx(event.transactionHash);
            return <motion.li key={event.id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-3 last:border-b-0">
              <span className="grid size-[42px] place-items-center rounded-[14px]" style={{ background: style.bg, color: style.fg }}><style.icon size={18} strokeWidth={2.1} /></span>
              <span className="min-w-0">
                <b className="block break-words text-sm font-semibold" title={sentence(event.kind, who, event.recipient)} aria-label={sentence(event.kind, who, event.recipient)}>{sentence(event.kind, label, event.recipient)}</b>
                <small className="text-[12.5px] text-muted">{time ? timeAgo(time) : `Block ${event.blockNumber}`}{link ? <> · <a href={link} target="_blank" rel="noreferrer" className="font-medium text-[#6f4bea] hover:underline">receipt</a></> : null}</small>
              </span>
              {event.amount !== undefined ? <span className="text-right text-sm font-semibold">{style.sign === "-" ? "−" : style.sign}{units(BigInt(event.amount))}</span> : <span />}
            </motion.li>;
          })}
        </AnimatePresence>
      </ul>}
    {activity.hasNextPage ? <Button variant="soft" size="sm" className="mt-3 w-full" loading={activity.isFetchingNextPage} onClick={() => void activity.fetchNextPage()}>Load older activity</Button> : null}
    </div>
  </section>;
}
