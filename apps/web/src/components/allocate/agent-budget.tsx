"use client";

import { spaceAccountAbi } from "@accord/chain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccordClient } from "@accord/sdk";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AtSign, Bot, Fingerprint, Loader2, Plug, UserRound } from "lucide-react";
import { useState } from "react";
import { getAddress, parseUnits, zeroAddress, type Hex } from "viem";
import { useAccord } from "@/lib/accord";
import { parseAgentWallet, resolveAgentWallet, type AgentWalletInput } from "@/lib/agent-wallet";
import { describeError } from "@/lib/errors";
import { useChainActions } from "@/lib/use-chain-actions";
import { useSponsoredTransaction } from "@/lib/use-sponsored-transaction";
import { useAgentIdentities } from "../agent-identity";
import { AmountField } from "../amount-field";
import { Button } from "../ui/button";
import { AgentSetupButton } from "../agent-tools";

type Funding=Awaited<ReturnType<AccordClient["createAllocation"]>>;
type Defaults={label:string;agent:string;daily:string;per:string;threshold:string;ends:string};
export function AgentBudget({address,draftId,allocationId,defaults,initialAgent,pairingId}:{address:string;draftId:string;allocationId?:string;defaults?:Defaults;initialAgent?:string;pairingId?:string}) {
  const {client,account,checkSession}=useAccord(),router=useRouter(),cache=useQueryClient();
  const identities=useAgentIdentities(draftId),sponsor=useSponsoredTransaction();
  const {requireWallet,sendPermitTransaction,chain}=useChainActions(address);
  const [label,setLabel]=useState(defaults?.label??"research"),[agent,setAgent]=useState(defaults?.agent??initialAgent??"");
  const [manual,setManual]=useState(!!defaults?.agent || !!initialAgent);
  const [total,setTotal]=useState("100"),[daily,setDaily]=useState(defaults?.daily??"100");
  const [per,setPer]=useState(defaults?.per??"25"),[threshold,setThreshold]=useState(defaults?.threshold??"10");
  const [ends,setEnds]=useState(()=>defaults?.ends??new Date(Date.now()+14*86400_000).toISOString().slice(0,10));
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [confirmedWallet,setConfirmedWallet]=useState<string|null>(null);
  let walletInput:AgentWalletInput|undefined, walletInputError:string|undefined;
  try { if(agent.trim())walletInput=parseAgentWallet(agent); }
  catch(error) { walletInputError=(error as Error).message; }
  const ensName=walletInput?.name;
  const ens=useQuery({queryKey:["agent-wallet-ens",ensName],enabled:!!client && !!ensName,
    queryFn:()=>resolveAgentWallet(ensName!,client!.resolveEnsRecipient),staleTime:60_000,retry:false,refetchOnWindowFocus:false});
  const signer=walletInput?.address??(ensName?ens.data:undefined);
  const confirmation=ensName && signer?`${ensName}:${signer}`:null;
  const walletReady=!!signer && (!ensName || (!ens.isFetching && !ens.isError && confirmedWallet===confirmation));
  const walletError=walletInputError??(ensName && ens.isError?ens.error.message:undefined);
  const storageKey=`accord:agent-funding:${draftId}:${account}`;
  const saved=useQuery({queryKey:[storageKey],enabled:!allocationId,queryFn:()=>{
    try {const value=localStorage.getItem(storageKey);return value?JSON.parse(value) as Funding:null;}catch{return null;}
  },staleTime:Infinity});
  function remember(value:Funding|null) {
    cache.setQueryData([storageKey],value);
    try{if(value)localStorage.setItem(storageKey,JSON.stringify(value));else localStorage.removeItem(storageKey);}catch{/* the current page still retains the request */}
  }
  async function submit(event:React.FormEvent) {
    event.preventDefault();if(!client || busy)return;setBusy(true);setMessage("");
    try {
      requireWallet();
      if(!/^[a-z0-9][a-z0-9-]{0,31}$/.test(label))throw new Error("Choose a short lowercase agent name.");
      if(!walletReady || !signer)throw new Error(walletError??"Confirm the agent wallet before continuing.");
      async function checkWallet() {
        try { return await resolveAgentWallet(agent,client!.resolveEnsRecipient,signer); }
        catch(error) {
          if(ensName){setConfirmedWallet(null);void cache.invalidateQueries({queryKey:["agent-wallet-ens",ensName]});}
          throw error;
        }
      }
      const dailyCap=parseUnits(daily,6),maxPerPayment=parseUnits(per,6),approvalThreshold=parseUnits(threshold,6);
      const expiry=Math.floor(Date.parse(`${ends}T23:59:59Z`)/1000);
      if(dailyCap<=BigInt(0)||maxPerPayment<=BigInt(0))throw new Error("Set a daily cap and a per-payment limit above zero.");
      if(maxPerPayment>dailyCap)throw new Error("The per-payment limit can’t be more than the daily cap.");
      if(approvalThreshold<BigInt(0)||approvalThreshold>maxPerPayment)throw new Error("The approval threshold can’t be more than the per-payment limit.");
      if(!Number.isFinite(expiry)||expiry*1000<=Date.now())throw new Error("Pick an end date after today.");
      const agentAddress=await checkWallet();
      let id=allocationId;
      if(!id) {
        let funding=saved.data;
        if(funding && chain) {
          const used=await chain.readContract({address:getAddress(address),abi:spaceAccountAbi,functionName:"consumedRequests",args:[funding.permit.requestId as Hex]});
          if(!used && BigInt(funding.permit.expiry)<(await chain.getBlock()).timestamp){remember(null);throw new Error("The saved funding request expired. Enter the budget and continue again.");}
        }
        if(!funding) {
          const amount=parseUnits(total,6);if(amount<=BigInt(0))throw new Error("Enter a positive budget.");
          funding=await client.createAllocation({draftId,requestKey:crypto.randomUUID(),beneficiary:zeroAddress,amount:amount.toString(),periodCap:amount.toString(),period:0});
          remember(funding);
        }
        const prepared=funding;
        await sendPermitTransaction(prepared.permit.requestId as Hex,()=>sponsor.sendWithApproval(prepared,setMessage));
        id=funding.permit.allocationId;
      }
      // Funding may take several blocks. Keep authorization bound to the wallet the owner reviewed.
      if(ensName)await checkWallet();
      setMessage("Preparing the agent authorization…");
      const request=await client.prepareAgent({draftId,requestKey:crypto.randomUUID(),allocationId:id,label,agent:agentAddress,
        dailyCap:dailyCap.toString(),maxPerPayment:maxPerPayment.toString(),approvalThreshold:approvalThreshold.toString(),expiry:String(expiry)});
      if(pairingId)sessionStorage.setItem(`accord:pairing-return:${request.id}`,pairingId);
      if(!allocationId)remember(null);
      router.push(`/approvals/${request.id}`);
    }catch(error){checkSession(error);setMessage(describeError(error,"The agent setup could not be completed."));}
    finally{setBusy(false);}
  }
  return <section className="card overflow-hidden">
    <div className="bg-[#eae2ff] p-7 sm:p-9">
      {!allocationId?<div className="mb-5 inline-flex rounded-full bg-white/50 p-1">
        <Link href={`/spaces/${address}/new?for=person`} className="flex items-center gap-2 rounded-full px-4 py-2 font-semibold"><UserRound size={16}/>A person</Link>
        <span className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 font-semibold text-white"><Bot size={16}/>An agent</span></div>:null}
      <div className="flex items-center gap-3"><span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/75 text-[#6544ba]"><AtSign size={25}/></span>
        <div><span className="text-sm font-semibold text-[#6544ba]">ENSv2 agent identity</span><h1 className="font-display text-3xl font-extrabold">{allocationId?"Edit agent authority":"Give an agent a budget"}</h1></div></div>
      <p className="mt-3 text-ink-soft">Give your agent a name, set its limits, and choose when it needs your approval.</p>
    </div>
    <form className="grid gap-5 p-7 sm:p-9" onSubmit={event=>void submit(event)}>
      {pairingId?<p className="flex items-start gap-3 rounded-2xl bg-lilac-soft p-4 text-sm text-ink-soft"><Plug size={18} className="mt-0.5 shrink-0 text-[#6544ba]"/>You’re setting up the signer from your terminal. After you authorize it with World ID, you’ll return to finish connecting your assistant.</p>:null}
      {!allocationId && !initialAgent?<div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-soft p-4"><AgentSetupButton/><button type="button" disabled={busy} className="text-sm font-semibold text-muted hover:text-ink" onClick={()=>{setManual(!manual);if(manual){setAgent("");setConfirmedWallet(null);setMessage("");}}}>{manual?"Hide manual entry":"Enter a wallet manually"}</button></div>:null}
      <div className={`grid gap-4 ${manual?"sm:grid-cols-[1fr_1.5fr]":""}`}><div><label className="font-semibold" htmlFor="agent-label">Agent name</label><input id="agent-label" className="field mt-2" value={label} onChange={e=>setLabel(e.target.value.toLowerCase())} required pattern="[a-z0-9][a-z0-9-]{0,31}" disabled={busy}/></div>
        {manual?<div className="min-w-0"><label className="font-semibold" htmlFor="agent-wallet">{initialAgent?"Signer from your terminal":"Agent wallet"}</label><input id="agent-wallet" className="field mt-2" value={agent} onChange={e=>{setAgent(e.target.value);setConfirmedWallet(null);setMessage("");}} placeholder="0x… or name.eth" required readOnly={!!initialAgent} disabled={busy} autoComplete="off" spellCheck={false} aria-invalid={!!walletError} aria-describedby="agent-wallet-status"/>
          <div id="agent-wallet-status" aria-live="polite" className="mt-2 text-sm">
            {walletError?<p className="text-bad">{walletError}{ensName && ens.isError?<button type="button" className="ml-2 font-semibold underline" onClick={()=>void ens.refetch()}>Try again</button>:null}</p>
              :ensName && ens.isFetching?<p className="flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin"/>Looking up ENS on Sepolia…</p>
              :!initialAgent?<p className="text-muted">Enter a wallet address or an ENS name on Sepolia.</p>:null}
          </div>
          {ensName && signer && !ens.isError && !ens.isFetching?<div className="mt-3 rounded-2xl bg-soft p-4">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1"><b className="min-w-0 break-all text-sm">{ensName}</b><span className="text-xs text-muted">Sepolia</span></p>
            <p className="address mt-2 break-all text-ink-soft">{signer}</p>
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm font-medium"><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[#16122b]" checked={confirmedWallet===confirmation} disabled={busy} onChange={e=>setConfirmedWallet(e.target.checked?confirmation:null)}/>Use this wallet for the agent</label>
          </div>:null}
        </div>:null}</div>
      <div className="rounded-2xl bg-lilac-soft p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-[#6544ba]"><AtSign size={16}/>{allocationId?"ENSv2 agent name":"ENSv2 name preview"}</p>
        <p className="mt-2 break-all text-sm font-semibold">{identities.data?`${label||"agent"}.${identities.data.namespace}`:"Loading name preview…"}</p>
        <p className="mt-2 text-sm text-ink-soft">{allocationId?"This name identifies your agent within this Space. Revoking it stops the agent’s payments.":"This ENS name is created when you authorize the agent. It identifies the agent within your Space; revoking it stops the agent’s payments."}</p>
      </div>
      {!allocationId?<div>{saved.data?<p className="rounded-2xl bg-soft p-4 text-sm">A funding request is saved. Continue to finish setup, or manage the budget from its Space.</p>:<AmountField id="agent-total" label="Total budget" value={total} onChange={setTotal} symbol="tUSDC" quick={["100","250","1000"]}/>}</div>:null}
      <div className="grid gap-4 sm:grid-cols-2"><AmountField id="agent-daily" label="Daily cap" value={daily} onChange={setDaily} symbol="tUSDC"/><AmountField id="agent-per" label="Max per payment" value={per} onChange={setPer} symbol="tUSDC"/></div>
      <div><AmountField id="agent-threshold" label="Require approval above" value={threshold} onChange={setThreshold} symbol="tUSDC"/><p className="mt-2 text-sm text-muted">Set to 0 to approve every payment.</p></div>
      <div><label className="font-semibold" htmlFor="agent-expiry">Authority ends</label><input className="field mt-2" id="agent-expiry" type="date" value={ends} onChange={e=>setEnds(e.target.value)} required disabled={busy}/></div>
      <p className="flex items-center gap-2 text-sm text-muted"><Fingerprint size={17} className="shrink-0"/>Review these terms with World ID before authorizing the agent.</p>
      {message?<p role="status" className="rounded-2xl bg-soft p-4 text-sm">{message}</p>:null}
      <Button size="lg" type="submit" loading={busy} disabled={!walletReady || !identities.data || (!allocationId && saved.isPending)}>{allocationId?"Review changes":saved.data?"Continue setup":"Fund and review"}</Button>
    </form>
  </section>;
}
