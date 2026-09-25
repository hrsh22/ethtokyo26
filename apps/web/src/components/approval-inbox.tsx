"use client";

import { formatUnits } from "viem";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Fingerprint } from "lucide-react";
import { useAccord } from "@/lib/accord";

export function ApprovalInbox() {
  const {client,auth,account}=useAccord();
  const query=useQuery({queryKey:["owner-approvals",account],enabled:!!client && auth.signedIn,
    queryFn:()=>client!.approvals(),refetchInterval:5000});
  const requests=query.data?.requests.filter(r=>["pending","verified","approved","issued"].includes(r.status))??[];
  if(!requests.length)return null;
  return <section className="mt-8" aria-labelledby="approvals-heading">
    <div className="mb-4 flex items-center gap-3"><h2 id="approvals-heading" className="font-display text-3xl font-extrabold">Needs your approval</h2><span className="pill bg-[#eae2ff]">{requests.length}</span></div>
    <div className="grid gap-3">{requests.map(r=><Link key={r.id} href={`/approvals/${r.id}`} className="card flex items-center gap-4 p-5 transition-transform hover:-translate-y-0.5">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#eae2ff] text-[#6544ba]"><Fingerprint size={22}/></span>
      <div className="min-w-0 flex-1"><b className="block truncate font-display text-xl font-extrabold">{r.agentName}</b><p className="text-sm text-muted">{r.spaceName} · {r.kind==="payment"?"Payment request":r.kind==="fund"?"Budget increase":"Agent authorization"}</p></div>
      <span className="font-semibold">{formatUnits(BigInt(r.amount),6)} tUSDC</span><ArrowUpRight size={18}/>
    </Link>)}</div>
  </section>;
}
