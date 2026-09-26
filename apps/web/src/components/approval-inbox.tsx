"use client";

import { formatUnits } from "viem";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ApprovalRequest } from "@accord/sdk";
import { ArrowUpRight, Fingerprint } from "lucide-react";
import { useAccord } from "@/lib/accord";

/**
 * Requests still waiting on the owner. An approved payment waits on the agent instead, so it leaves the inbox;
 * an approved authorization or budget increase still needs the owner to submit it.
 */
export const needsOwner = (r: ApprovalRequest) => r.status === "pending" || r.status === "verified" || (r.kind !== "payment" && (r.status === "approved" || r.status === "issued"));
const kindLabel = (r: ApprovalRequest) => r.kind === "payment" ? r.purchaseTitle ?? "Payment request" : r.kind === "fund" ? "Budget increase" : "Agent authorization";
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function ApprovalInbox({ spaceAddress, allocationId, className = "mt-8" }: { spaceAddress?: string; allocationId?: string; className?: string }) {
  const {client,auth,account}=useAccord();
  const query=useQuery({queryKey:["owner-approvals",account],enabled:!!client && auth.signedIn,
    queryFn:()=>client!.approvals(),refetchInterval:5000});
  const requests=query.data?.requests.filter(r=>needsOwner(r)
    && (!spaceAddress || r.spaceAddress.toLowerCase()===spaceAddress.toLowerCase()) && (!allocationId || r.allocationId===allocationId))??[];
  if(!requests.length)return null;
  return <section className={className} aria-labelledby={`approvals-heading-${allocationId ?? spaceAddress ?? "all"}`}>
    <div className="mb-4 flex items-center gap-3"><h2 id={`approvals-heading-${allocationId ?? spaceAddress ?? "all"}`} className="font-display text-3xl font-extrabold">Needs your approval</h2><span className="pill bg-[#eae2ff]">{requests.length}</span></div>
    <div className="grid gap-3">{requests.map(r=><Link key={r.id} href={`/approvals/${r.id}`} className="card flex items-center gap-4 p-5 ring-2 ring-lilac/60 transition-transform hover:-translate-y-0.5">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#eae2ff] text-[#6544ba]"><Fingerprint size={22}/></span>
      <div className="min-w-0 flex-1"><b className="block truncate font-display text-xl font-extrabold" title={r.agentName}>{r.agentName.split(".")[0]}</b>
        <p className="text-sm text-muted">{spaceAddress ? "" : `${r.spaceName} · `}{kindLabel(r)}{r.status === "approved" || r.status === "issued" ? " · finish authorization" : ` · until ${time(r.expiresAt)}`}</p></div>
      <span className="shrink-0 font-semibold">{formatUnits(BigInt(r.amount),6)} tUSDC</span><ArrowUpRight size={18} className="shrink-0"/>
    </Link>)}</div>
  </section>;
}
