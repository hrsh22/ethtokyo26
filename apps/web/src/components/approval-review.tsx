"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AtSign, Check, Fingerprint } from "lucide-react";
import { useState } from "react";
import { encodeFunctionData, erc20Abi, formatUnits, getAddress, type Hex } from "viem";
import { useAccord } from "@/lib/accord";
import { describeError } from "@/lib/errors";
import { useChainActions } from "@/lib/use-chain-actions";
import { useSponsoredTransaction } from "@/lib/use-sponsored-transaction";
import { Button } from "./ui/button";
import { SignInCard } from "./sign-in-card";

const units=(v:string)=>`${formatUnits(BigInt(v),6)} tUSDC`;
export function ApprovalReview({id}:{id:string}) {
  const {client,auth,account,checkSession}=useAccord(),router=useRouter(),params=useSearchParams(),cache=useQueryClient();
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const query=useQuery({queryKey:["approval",id,account],queryFn:()=>client!.approval(id),enabled:!!client && auth.signedIn,refetchInterval:5000});
  const row=query.data,sponsor=useSponsoredTransaction();
  const {sendPermitTransaction,waitForSuccess}=useChainActions(row?.spaceAddress??"0x0000000000000000000000000000000000000000");
  if(!auth.signedIn)return <SignInCard title="Sign in to review" body="Use the wallet that owns this Space."/>;
  if(!row)return <div className="card p-8">{query.isError?"This request could not be loaded. Check that you're using the right wallet.":"Loading request…"}</div>;
  const owner=account?.toLowerCase()===row.owner.toLowerCase();
  const ready=row.status==="verified" || row.status==="approved" || row.status==="issued";
  const terminal=["denied","cancelled","expired","invalidated"].includes(row.status);
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
          if(BigInt(permit.approvalAmount)>BigInt(0)) {
            const tx=await sponsor.send(getAddress(permit.tokenAddress),encodeFunctionData({abi:erc20Abi,functionName:"approve",args:[getAddress(permit.spaceAddress),BigInt(permit.approvalAmount)]}));
            await waitForSuccess(tx);
          }
          setMessage("Confirm the authorization in your wallet.");
          await sendPermitTransaction(permit.permit.requestId as Hex,()=>sponsor.send(getAddress(permit.spaceAddress),permit.calldata as Hex));
          await cache.invalidateQueries();
          router.push(`/spaces/${row.spaceAddress}/a/${row.allocationId}`);
        }
      }
      await query.refetch();await cache.invalidateQueries({queryKey:["owner-approvals"]});
    }catch(error){checkSession(error);setMessage(describeError(error,"The approval could not be completed."));}
    finally{setBusy(false);}
  }
  return <div className="mx-auto max-w-[720px]">
    <Link className="mb-5 inline-flex items-center gap-2 font-semibold text-muted" href={`/spaces/${row.spaceAddress}`}><ArrowLeft size={18}/>{row.spaceName}</Link>
    <section className="card overflow-hidden">
      <div className="bg-[#eae2ff] p-7 sm:p-9"><span className="pill bg-white"><AtSign size={14}/>ENSv2 agent</span>
        <h1 className="mt-4 break-all font-display text-4xl font-extrabold">{row.agentName}</h1>
        <p className="mt-2 text-ink-soft">{row.kind==="payment"?"Review this payment":row.kind==="fund"?"Increase the agent's budget":"Authorize this agent"}</p></div>
      <div className="p-7 sm:p-9"><dl className="grid gap-4 sm:grid-cols-2">
        <div><dt className="text-sm text-muted">{row.kind==="payment"?"Amount":"Budget"}</dt><dd className="font-display text-3xl font-extrabold">{units(row.amount)}</dd></div>
        {row.recipient?<div><dt className="text-sm text-muted">Recipient</dt><dd className="mt-1 break-all font-mono text-sm">{row.recipient}</dd></div>:null}
        {row.dailyCap?<div><dt className="text-sm text-muted">Daily cap</dt><dd className="font-semibold">{units(row.dailyCap)}</dd></div>:null}
        {row.maxPerPayment?<div><dt className="text-sm text-muted">Per payment</dt><dd className="font-semibold">{units(row.maxPerPayment)}</dd></div>:null}
        {row.approvalThreshold!==undefined?<div><dt className="text-sm text-muted">Owner approval</dt><dd className="font-semibold">{row.approvalThreshold==="0"?"Every payment":`Above ${units(row.approvalThreshold)}`}</dd></div>:null}
        {row.expiry?<div><dt className="text-sm text-muted">Agent expires</dt><dd className="font-semibold">{new Date(Number(row.expiry)*1000).toLocaleDateString()}</dd></div>:null}
      </dl>
      {row.verified?<span className="pill mt-5 bg-good-soft text-good"><Fingerprint size={14}/>World ID verified</span>:null}
      <details className="mt-5 text-sm text-muted"><summary className="cursor-pointer font-semibold">Agent wallet</summary><p className="mt-2 break-all font-mono">{row.agent}</p></details>
      {row.status==="executed"?<p role="status" className="mt-6 flex items-center gap-2 rounded-2xl bg-good-soft p-4 font-semibold text-good"><Check size={20}/>{row.kind==="payment"?"Payment completed.":"Agent authority confirmed."}</p>:terminal?<p role="status" className="mt-6 rounded-2xl bg-bad-soft p-4 font-semibold text-bad">Request {row.status}. No new authorization will be issued.</p>
        :row.kind==="payment" && ["approved","issued"].includes(row.status)?<p role="status" className="mt-6 flex items-center gap-2 rounded-2xl bg-good-soft p-4 font-semibold text-good"><Check size={20}/>Approved. The agent can continue this payment.</p>
        :owner?<div className="mt-7">
          {params.get("world")==="failed" && !ready?<p className="mb-4 text-sm text-bad">Verification did not complete. Use the same World identity and try again.</p>:null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" disabled={busy} onClick={()=>void act("deny")}>Deny</Button>
            {ready?<Button size="lg" loading={busy} onClick={()=>void act("approve")}>{row.kind==="payment"?"Approve payment":row.kind==="fund"?"Approve increase":"Authorize agent"}</Button>
              :<Button size="lg" loading={busy} onClick={()=>void act("verify")}><Fingerprint/>Verify with World ID</Button>}
          </div>
          <p className="mt-3 text-right text-sm text-muted">{ready?"You are approving the terms shown above.":"A fresh check from the Space owner is required."}</p>
        </div>:<p role="status" className="mt-6 rounded-2xl bg-soft p-4">Waiting for the Space owner to review this request.</p>}
      {message?<p role="status" className="mt-4 text-sm text-ink-soft">{message}</p>:null}
      </div>
    </section>
  </div>;
}
