"use client";

import { formatUnits } from "viem";
import { useQuery } from "@tanstack/react-query";
import { AtSign, ArrowUpRight, Check, Copy, Fingerprint, Info, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAccord } from "@/lib/accord";
import { shortDate } from "@/lib/format";
import { Button } from "./ui/button";
import { Sheet } from "./ui/sheet";

export function useAgentIdentities(draftId?: string) {
  const { client } = useAccord();
  return useQuery({queryKey:["agent-identities",draftId],enabled:!!client && !!draftId,
    queryFn:()=>client!.agentIdentities(draftId!),refetchInterval:15_000,retry:1});
}
export function SpaceNamespace({draftId}:{draftId?:string}) {
  const query=useAgentIdentities(draftId);
  const [open,setOpen]=useState(false),[copied,setCopied]=useState(false);
  if(!query.data?.registry)return null;
  const {namespace,registry,active}=query.data;
  async function copy() {
    try {await navigator.clipboard.writeText(namespace);setCopied(true);setTimeout(()=>setCopied(false),1800);}
    catch {toast.error("Couldn’t copy. Select the name and copy it yourself.");}
  }
  return <>
    <button type="button" onClick={()=>setOpen(true)} title={namespace} aria-label={`About this Space’s ENS name: ${namespace}`}
      className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full bg-white/70 px-3 py-2 text-sm text-ink-soft transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-lilac">
      <AtSign size={16} className="shrink-0 text-[#6544ba]"/>
      <span className="shrink-0 font-semibold">Space ENS</span>
      <span className="min-w-0 truncate text-muted">{namespace}</span>
      <Info size={15} className="shrink-0 text-muted"/>
    </button>
    <Sheet open={open} onOpenChange={setOpen} title="Your Space’s ENS name" description="A unique public name for this Space on Sepolia.">
      <div className="rounded-2xl bg-lilac-soft p-4">
        <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-[#6544ba]"><AtSign size={16}/>ENSv2</span>
          <span className={`pill ${active?"bg-good-soft text-good":"bg-bad-soft text-bad"}`}>{active?"Registered":"Inactive"}</span></div>
        <p className="mt-3 break-all font-semibold">{namespace}</p>
        <Button size="sm" variant="onColor" className="mt-3" onClick={()=>void copy()}>{copied?<Check/>:<Copy/>}{copied?"Copied":"Copy name"}</Button>
      </div>
      <p className="mt-4 text-sm text-ink-soft">The name identifies this Space, whether you use it for people, agents, or both. The short suffix keeps it unique.</p>
      <div className="mt-4 rounded-2xl bg-soft p-4">
        <p className="text-sm font-semibold">Agent names live underneath it</p>
        <p className="mt-1 text-sm text-muted">If you add an agent called research, its name will be:</p>
        <p className="mt-2 break-all text-sm text-muted"><b className="text-[#6544ba]">research.</b>{namespace}</p>
      </div>
      <a href={`https://sepolia.etherscan.io/address/${registry}`} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-[#6544ba] hover:underline">View ENS registry<ArrowUpRight size={15}/></a>
    </Sheet>
  </>;
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
