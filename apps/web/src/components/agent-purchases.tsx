"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, FileSearch } from "lucide-react";
import type { AccordClient } from "@accord/sdk";
import { useAccord } from "@/lib/accord";
import { amount, timeAgo } from "@/lib/format";
import { explorerTx } from "@/lib/use-chain-actions";

type Operation = Awaited<ReturnType<AccordClient["agentOperations"]>>["operations"][number];
const active = ["quoted", "awaiting_approval", "ready", "submitted", "reconciling"];
const look: Record<string, { label: string; tone: string }> = {
  quoted: { label: "Quoted, not paid", tone: "bg-soft text-muted" },
  awaiting_approval: { label: "Needs your approval", tone: "bg-lilac-soft text-[#6544ba]" },
  ready: { label: "Approved, waiting for the agent", tone: "bg-good-soft text-good" },
  submitted: { label: "Payment confirming", tone: "bg-warn-soft text-warn" },
  reconciling: { label: "Payment confirming", tone: "bg-warn-soft text-warn" },
  confirmed: { label: "Paid", tone: "bg-good-soft text-good" },
  delivered: { label: "Paid and delivered", tone: "bg-good-soft text-good" },
  denied: { label: "Denied, nothing paid", tone: "bg-bad-soft text-bad" },
  cancelled: { label: "Cancelled, nothing paid", tone: "bg-soft text-muted" },
  expired: { label: "Expired, nothing paid", tone: "bg-soft text-muted" },
  invalidated: { label: "Stopped, nothing paid", tone: "bg-bad-soft text-bad" },
};
const statusLook = (status: string) => look[status] ?? { label: "Needs review", tone: "bg-warn-soft text-warn" };

/** What the paired assistant quoted and bought through the toolkit, for the Space owner. Paid results stay with the agent. */
export function AgentPurchases({ draftId, allocationId }: { draftId: string; allocationId: string }) {
  const { client, account } = useAccord();
  const query = useQuery({ queryKey: ["agent-operations", draftId, allocationId, account], enabled: !!client,
    queryFn: () => client!.agentOperations(draftId, allocationId), retry: 1,
    refetchInterval: (q) => q.state.data?.operations.some(o => active.includes(o.status)) ? 8_000 : 30_000 });
  const operations = query.data?.operations ?? [];
  return <section className="card p-6" aria-labelledby="purchases-heading">
    <div className="flex items-start gap-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-sky-soft text-[#2B7CC4]"><FileSearch size={21}/></span>
      <div className="min-w-0"><h2 id="purchases-heading" className="font-display text-2xl font-extrabold">Assistant purchases</h2>
        <p className="mt-1 text-sm text-muted">Research your assistant quoted or bought through Accord’s MCP tools or SDK.</p></div>
    </div>
    {query.isPending ? <div className="mt-4 grid gap-2">{[0, 1].map(i => <div key={i} className="h-20 animate-pulse rounded-2xl bg-soft"/>)}</div>
      : query.isError ? <p role="status" className="mt-4 text-sm text-muted">Purchases couldn’t be loaded. <button type="button" className="font-semibold text-ink underline" onClick={() => void query.refetch()}>Retry</button></p>
      : !operations.length ? <p className="mt-4 rounded-2xl bg-soft p-4 text-sm text-muted">Nothing yet. When your assistant asks for a quote, it appears here with its price and status.</p>
      : <ul className="mt-4 grid gap-2">{operations.map(operation => <Purchase key={operation.quote.id} operation={operation}/>)}</ul>}
  </section>;
}

function Purchase({ operation }: { operation: Operation }) {
  const { quote, status, transactionHash, approvalId } = operation;
  const state = statusLook(status), receipt = transactionHash ? explorerTx(transactionHash) : undefined;
  return <li className="rounded-2xl bg-soft p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <b className="min-w-0">{quote.title}</b>
      <b className="font-display text-lg font-extrabold">{amount(BigInt(quote.amount), 6, "tUSDC")}</b>
    </div>
    <p className="mt-1 break-words text-sm text-ink-soft">{quote.repositories.join(" · ")}</p>
    {quote.criteria.length ? <p className="mt-0.5 text-xs text-muted">Criteria: {quote.criteria.join(", ")}</p> : null}
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <span className={`pill ${state.tone}`}>{state.label}</span>
      <span className="text-xs text-muted">Quoted {timeAgo(Date.parse(quote.collectedAt) / 1000)}</span>
      <span className="ml-auto flex items-center gap-3">
        {status === "awaiting_approval" && approvalId ? <Link href={`/approvals/${approvalId}`} className="inline-flex items-center gap-1 font-semibold text-[#6544ba] hover:underline">Review<ArrowUpRight size={14}/></Link> : null}
        {receipt ? <a href={receipt} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#6f4bea] hover:underline">Receipt<ArrowUpRight size={14}/></a> : null}
      </span>
    </div>
  </li>;
}
