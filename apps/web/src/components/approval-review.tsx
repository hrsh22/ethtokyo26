"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AtSign, Check, CircleSlash, Clock3, FileSearch, Fingerprint } from "lucide-react";
import { useState } from "react";
import { formatUnits, type Hex } from "viem";
import { useAccord } from "@/lib/accord";
import { describeError } from "@/lib/errors";
import { useChainActions } from "@/lib/use-chain-actions";
import { useSponsoredTransaction } from "@/lib/use-sponsored-transaction";
import { Button } from "./ui/button";
import { SignInCard } from "./sign-in-card";

const units=(v:string)=>`${formatUnits(BigInt(v),6)} tUSDC`;
const stopped:Record<string,string>={
  denied:"You denied this request. Nothing was paid, and the agent can’t use it.",
  cancelled:"This request was cancelled. Nothing was paid.",
  expired:"This request expired before it was used. Nothing was paid.",
  invalidated:"The agent’s authority changed, for example its ENS identity was revoked, so this request can’t be used. Nothing was paid.",
};
/** Toolkit research quotes describe themselves as "owner/repo, owner/repo · criterion; criterion". */
function researchTerms(description?:string) {
  if(!description)return null;
  const [repositories="",criteria=""]=description.split(" · ");
  return {repositories:repositories.split(", ").filter(Boolean),criteria:criteria.split("; ").filter(Boolean)};
}
export function ApprovalReview({id}:{id:string}) {
  const {client,auth,account,checkSession}=useAccord(),router=useRouter(),params=useSearchParams(),cache=useQueryClient();
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const query=useQuery({queryKey:["approval",id,account],queryFn:()=>client!.approval(id),enabled:!!client && auth.signedIn,refetchInterval:5000});
  const row=query.data,sponsor=useSponsoredTransaction();
  const {sendPermitTransaction}=useChainActions(row?.spaceAddress??"0x0000000000000000000000000000000000000000");
  if(!auth.signedIn)return <SignInCard title="Sign in to review" body="Use the wallet that owns this Space."/>;
  if(!row)return <div className="card mx-auto max-w-[720px] p-8">{query.isError?"This request could not be loaded. Check that you're using the Space owner’s wallet.":"Loading request…"}</div>;
  const owner=account?.toLowerCase()===row.owner.toLowerCase();
  const ready=row.status==="verified" || row.status==="approved" || row.status==="issued";
  const terminal=row.status in stopped;
  const payment=row.kind==="payment";
  const research=row.purchaseTitle?researchTerms(row.purchaseDescription):null;
  const agentPage=`/spaces/${row.spaceAddress}/a/${row.allocationId}`;
  async function act(decision:"verify"|"approve"|"deny") {
    if(!client || busy || !row)return;setBusy(true);setMessage("");
    try {
      if(decision==="verify") {const {url}=await client.authenticateApproval(id);window.location.assign(url);return;}
      if(decision==="deny")await client.decideApproval(id,"deny");
      else {
        if(row.status==="verified")await client.decideApproval(id,"approve");
        if(row.kind!=="payment") {
          setMessage(row.kind==="grant"?"Preparing the ENS identity…":"Preparing the budget increase…");
          const permit=await client.issueAgentRequest(id);
          await sendPermitTransaction(permit.permit.requestId as Hex,()=>sponsor.sendWithApproval(permit,setMessage));
          await cache.invalidateQueries();
          const pairing=sessionStorage.getItem(`accord:pairing-return:${id}`);
          if(pairing && /^[0-9a-f-]{36}$/i.test(pairing)) {
            sessionStorage.removeItem(`accord:pairing-return:${id}`);router.push(`/connect/${pairing}`);
          } else router.push(agentPage);
        }
      }
      await query.refetch();await cache.invalidateQueries({queryKey:["owner-approvals"]});
    }catch(error){checkSession(error);setMessage(describeError(error,"The approval could not be completed."));}
    finally{setBusy(false);}
  }
  return <div className="mx-auto max-w-[720px]">
    <Link className="mb-5 inline-flex max-w-full items-center gap-2 font-semibold text-muted hover:text-ink" href={owner?agentPage:`/spaces/${row.spaceAddress}`}><ArrowLeft size={18} className="shrink-0"/><span className="truncate">{owner?`${row.agentName.split(".")[0]} in ${row.spaceName}`:row.spaceName}</span></Link>
    <section className="card overflow-hidden">
      <div className="bg-[#eae2ff] p-7 sm:p-9"><span className="pill bg-white"><AtSign size={14}/>ENSv2 agent</span>
        <h1 className="mt-4 break-words font-display text-4xl font-extrabold">{row.agentName.split(".")[0]}</h1>
        <p className="mt-2 break-all text-sm font-medium text-ink-soft">{row.agentName}</p>
        <p className="mt-2 text-ink-soft">{payment?"Review this payment request. Nothing is paid until you approve it.":row.kind==="fund"?"Increase the agent's budget":"Authorize this agent"}</p></div>
      <div className="p-7 sm:p-9">
      {row.purchaseTitle?<div className="mb-6 rounded-2xl bg-soft p-4">
        <p className="flex items-center gap-2 font-semibold"><FileSearch size={18} className="shrink-0 text-[#2B7CC4]"/>{row.purchaseTitle}</p>
        {research?.repositories.length?<ul className="mt-3 flex flex-wrap gap-2">{research.repositories.map(repo=><li key={repo}><a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer" className="pill break-all bg-white hover:underline">{repo}</a></li>)}</ul>
          :<p className="mt-1 break-words text-sm text-muted">{row.purchaseDescription}</p>}
        {research?.criteria.length?<p className="mt-3 text-sm text-muted">Criteria: {research.criteria.join(", ")}</p>:null}
        <p className="mt-3 text-xs text-muted">Requested by your assistant through the Accord agent toolkit (MCP or SDK).</p>
      </div>:null}
      <dl className="grid gap-4 sm:grid-cols-2">
        <div><dt className="text-sm text-muted">{payment?"Amount":"Budget"}</dt><dd className="font-display text-3xl font-extrabold">{units(row.amount)}</dd></div>
        {row.recipient?<div><dt className="text-sm text-muted">Recipient</dt>{row.purchaseTitle?<dd className="mt-1 text-sm font-semibold">Accord example research service</dd>:null}<dd className="mt-1 break-all font-mono text-sm">{row.recipient}</dd></div>:null}
        {row.dailyCap?<div><dt className="text-sm text-muted">Daily cap</dt><dd className="font-semibold">{units(row.dailyCap)}</dd></div>:null}
        {row.maxPerPayment?<div><dt className="text-sm text-muted">Per payment</dt><dd className="font-semibold">{units(row.maxPerPayment)}</dd></div>:null}
        {row.approvalThreshold!==undefined?<div><dt className="text-sm text-muted">Owner approval</dt><dd className="font-semibold">{row.approvalThreshold==="0"?"Every payment":`Above ${units(row.approvalThreshold)}`}</dd></div>:null}
        {row.expiry?<div><dt className="text-sm text-muted">Agent expires</dt><dd className="font-semibold">{new Date(Number(row.expiry)*1000).toLocaleDateString()}</dd></div>:null}
      </dl>
      <div className="mt-5 flex flex-wrap gap-2">
        {row.verified?<span className="pill bg-good-soft text-good"><Fingerprint size={14}/>World ID verified</span>:null}
        {row.status==="pending" || row.status==="verified"?<span className="pill bg-soft text-muted"><Clock3 size={14}/>Decide before {new Date(row.expiresAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>:null}
      </div>
      <details className="mt-5 text-sm text-muted"><summary className="cursor-pointer font-semibold">Agent wallet</summary><p className="mt-2 break-all font-mono">{row.agent}</p></details>
      {row.status==="executed"?<div role="status" className="mt-6 rounded-2xl bg-good-soft p-4 text-good"><p className="flex items-center gap-2 font-semibold"><Check size={20}/>{payment?"Payment completed.":"Agent authority confirmed."}</p>
          {owner?<Link href={agentPage} className="mt-2 inline-flex text-sm font-semibold underline">{payment?"See it in the agent’s purchases":"Open the agent"}</Link>:null}</div>
        :terminal?<p role="status" className="mt-6 flex items-start gap-2 rounded-2xl bg-bad-soft p-4 font-semibold text-bad"><CircleSlash size={20} className="mt-0.5 shrink-0"/>{stopped[row.status]}</p>
        :payment && ["approved","issued"].includes(row.status)?<div role="status" className="mt-6 rounded-2xl bg-good-soft p-4"><p className="flex items-center gap-2 font-semibold text-good"><Check size={20}/>Approved. Your assistant can resume this purchase.</p>
          <p className="mt-1 text-sm text-ink-soft">It pays with the same quote. ENS authority and spending limits are checked again when the payment runs.</p></div>
        :owner?<div className="mt-7">
          {params.get("world")==="failed" && !ready?<p className="mb-4 text-sm text-bad">Verification did not complete. Use the same World identity and try again.</p>:null}
          {params.get("world")==="verified" && row.status==="verified"?<p className="mb-4 flex items-center gap-2 text-sm font-semibold text-good"><Check size={16}/>World verification complete. Review the terms, then decide.</p>:null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" disabled={busy} onClick={()=>void act("deny")}>Deny</Button>
            {ready?<Button size="lg" loading={busy} onClick={()=>void act("approve")}>{payment?"Approve payment":row.kind==="fund"?"Approve increase":"Authorize agent"}</Button>
              :<Button size="lg" loading={busy} onClick={()=>void act("verify")}><Fingerprint/>Verify with World ID</Button>}
          </div>
          <p className="mt-3 text-right text-sm text-muted">{ready?"You are approving the exact terms shown above.":payment ? "Verify as the same person who authorized this agent." : "Verify to authorize this agent’s budget."}</p>
        </div>:<p role="status" className="mt-6 rounded-2xl bg-soft p-4">Waiting for the Space owner to review this request.</p>}
      {message?<p role="status" className="mt-4 text-sm text-ink-soft">{message}</p>:null}
      </div>
    </section>
  </div>;
}
