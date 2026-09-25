"use client";

import { formatUnits } from "viem";
import { useQuery } from "@tanstack/react-query";
import { AtSign, ArrowUpRight, Fingerprint, ShieldCheck } from "lucide-react";
import { useAccord } from "@/lib/accord";
import { shortDate } from "@/lib/format";

export function useAgentIdentities(draftId?: string) {
  const { client } = useAccord();
  return useQuery({queryKey:["agent-identities",draftId],enabled:!!client && !!draftId,
    queryFn:()=>client!.agentIdentities(draftId!),refetchInterval:15_000,retry:1});
}
export function SpaceNamespace({draftId}:{draftId?:string}) {
  const query=useAgentIdentities(draftId);
  if(!query.data)return null;
  return <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
    <span className="pill bg-[#eae2ff] text-[#6544ba]"><AtSign size={14}/>ENSv2</span>
    <span className="break-all font-semibold text-ink-soft">{query.data.namespace}</span>
    {query.data.registry?<a href={`https://sepolia.etherscan.io/address/${query.data.registry}`} target="_blank" rel="noreferrer" aria-label="View ENS registry" className="text-muted hover:text-ink"><ArrowUpRight size={16}/></a>
      :<span className="text-muted">Created with your first agent</span>}
  </div>;
}
export function AgentIdentityCard({draftId,allocationId}:{draftId?:string;allocationId:string}) {
  const query=useAgentIdentities(draftId);
  const identity=query.data?.identities.find(i=>i.allocationId===allocationId);
  if(!identity)return null;
  return <section className="card p-6">
    <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-[#eae2ff] text-[#6544ba]"><AtSign size={22}/></span>
      <div className="min-w-0 flex-1"><span className="text-sm font-medium text-muted">Agent identity <span className="ml-1 font-semibold text-[#6544ba]">ENSv2</span></span>
        <h2 className="break-words font-display text-2xl font-extrabold">{identity.name.split(".")[0]}</h2></div></div>
    <p className="mt-3 break-all text-sm font-medium text-ink-soft">{identity.name}</p>
    <div className="mt-4 flex flex-wrap gap-2">
      <span className={`pill ${identity.active?"bg-good-soft text-good":"bg-bad-soft text-bad"}`}><ShieldCheck size={14}/>{identity.active?"Active":identity.revoked?"ENS identity revoked":identity.confirmed?"Identity unavailable":"Awaiting confirmation"}</span>
      {identity.confirmed?<span className="pill bg-[#eae2ff] text-[#6544ba]"><Fingerprint size={14}/>World-authorized</span>:null}
      <span className="pill bg-soft">Until {shortDate(Number(identity.expiry))}</span>
    </div>
    <p className="mt-3 text-sm text-muted">{identity.active?`Owner approval above ${formatUnits(BigInt(identity.approvalThreshold),6)} tUSDC.`:"Payments are unavailable while this identity is inactive."}</p>
    <details className="mt-3 text-sm text-muted"><summary className="cursor-pointer font-semibold">Identity details</summary>
      <p className="mt-2 break-all">Agent wallet: {identity.agent}</p>
      <a className="mt-1 inline-flex items-center gap-1 font-semibold text-[#6544ba]" href={`https://sepolia.etherscan.io/address/${identity.registry}`} target="_blank" rel="noreferrer">View ENS registry<ArrowUpRight size={14}/></a>
    </details>
  </section>;
}
