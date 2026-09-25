"use client";

import { spaceAccountAbi } from "@accord/chain";
import { paymentDecision, paymentApprovalRequired, type Decision, type PermitRequest } from "@accord/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PaymentReviewStatus } from "../payment-review-status";
import { useMemo, useState } from "react";
import { Send } from "lucide-react";
import { encodeFunctionData, getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { useAccord } from "@/lib/accord";
import { parseAmount } from "@/lib/amounts";
import { describeError, tagOf } from "@/lib/errors";
import { permitFrom, useChainActions } from "@/lib/use-chain-actions";
import { useSponsoredTransaction } from "@/lib/use-sponsored-transaction";
import type { AllocationData } from "@/lib/use-allocation";
import { AmountField } from "../amount-field";
import { PaymentDecision } from "../payment-decision";
import { TxTracker, useSteps } from "../tx-tracker";
import { Button } from "../ui/button";

/** The agent wallet paying from its budget in the browser. Most agents use the SDK; this is the same path. */
export function PayPanel({ address, draftId, data, decimals, symbol, units }: {
  address: string; draftId: string; data: AllocationData; decimals?: number; symbol: string; units: (value: bigint) => string;
}) {
  const { client, checkSession, account } = useAccord();
  const { requireWallet, sendPermitTransaction } = useChainActions(address);
  const sponsor = useSponsoredTransaction();
  const cache=useQueryClient(),storageKey=`accord:payment:${account}:${draftId}:${data.id}`;
  type Pending={payload:PermitRequest;approvalId?:string};
  const saved=useQuery({queryKey:[storageKey],queryFn:()=>{try{return JSON.parse(localStorage.getItem(storageKey)??"null") as Pending|null;}catch{return null;}},staleTime:Infinity});
  function remember(next:Pending|null){cache.setQueryData([storageKey],next);try{if(next)localStorage.setItem(storageKey,JSON.stringify(next));else localStorage.removeItem(storageKey);}catch{/* current tab retains it */}}

  const [recipient, setRecipient] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision>();
  const [settled, setSettled] = useState(false);
  const initial = useMemo(() => [
    { id: "check", label: "Check ENS authority and approvals" },
    { id: "wallet", label: "Confirm the payment in your wallet" },
  ], []);
  const tracker = useSteps(initial);
  const parsed = parseAmount(value, decimals, "Amount");
  const maxEach = data.mandate[5];
  const over = parsed.ok && parsed.value > maxEach;

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    if (!client || busy || (!saved.data && (!parsed.ok || over))) return;
    setBusy(true); setError(null); setDecision(undefined); setSettled(false); tracker.reset();
    try {
      requireWallet();
      const authorized = await tracker.run("check", "ENS authority and payment approval", async () => {
        const text = saved.data?.payload.recipient ?? recipient.trim();
        let to: Address;
        if (text.startsWith("0x")) {
          if (!isAddress(text) || text.toLowerCase() === zeroAddress) throw new Error("That isn't a valid recipient address.");
          to = getAddress(text);
        } else to = getAddress((await client.resolveEnsRecipient(text)).address);
        const payload=saved.data?.payload ?? {draftId,allocationId:data.id.toString(),amount:parsed.ok?parsed.value.toString():"0",recipient:to,requestKey:crypto.randomUUID()};
        remember({...saved.data,payload});
        let result;
        try{result=await client.authorizePayment(payload);}
        catch(error){const approval=paymentApprovalRequired(error);if(approval){remember({payload,approvalId:approval.id});return null;}throw error;}
        if (!result.signature) throw new Error("This payment wasn't authorized.");
        setDecision(result.decision);
        return { result, to };
      });
      if(!authorized)return;
      await tracker.run("wallet", "Sign the payment", () => sendPermitTransaction(authorized.result.permit.requestId as Hex, () =>
        sponsor.send(getAddress(authorized.result.spaceAddress), encodeFunctionData({ abi: spaceAccountAbi, functionName: "pay",
          args: [BigInt(authorized.result.permit.allocationId), authorized.to, BigInt(authorized.result.permit.amount),
            permitFrom(authorized.result), authorized.result.signature as Hex] }))));
      remember(null);
      setSettled(true);
      setValue("");
    } catch (cause) {
      checkSession(cause);
      const declined = paymentDecision(cause);
      if (declined) setDecision(declined);
      else setError(tagOf(cause) === "NotFound" ? "That name has no wallet on Sepolia." : describeError(cause, "The payment wasn't authorized or sent."));
    } finally { setBusy(false); }
  }

  return <section className="card p-6 sm:p-7" aria-labelledby="pay-heading">
    <h2 id="pay-heading" className="font-display text-3xl font-extrabold">Pay from this budget</h2>
    <p className="mt-1 text-muted">You’re signed in as the agent. Up to {units(maxEach)} per payment.</p>
    <form className="mt-5 grid gap-4" onSubmit={(event) => void pay(event)}>
      {!saved.data ? <div>
        <label htmlFor="pay-to" className="font-semibold">Recipient</label>
        <input id="pay-to" className="field mt-2" value={recipient} onChange={(event) => { setRecipient(event.target.value); setError(null); }}
          placeholder="name.eth or 0x…" required autoComplete="off" spellCheck={false} />
      </div> : <p className="rounded-2xl bg-soft p-4 text-sm">{units(BigInt(saved.data.payload.amount))} to <span className="break-all font-mono">{saved.data.payload.recipient}</span></p>}
      {!saved.data ? <AmountField id="pay-amount" label="Amount" value={value} onChange={(next) => { setValue(next); setError(null); }} symbol={symbol} /> : null}
      {!saved.data && over ? <p role="alert" className="text-sm font-medium text-bad">That’s more than the {units(maxEach)} per-payment limit.</p> : null}
      {saved.data?.approvalId ? <PaymentReviewStatus id={saved.data.approvalId}/> : null}
      {tracker.steps.some((step) => step.state !== "waiting") ? <TxTracker steps={tracker.steps} /> : null}
      {decision ? <PaymentDecision decision={decision} settled={settled} /> : null}
      {error ? <p role="alert" className="rounded-2xl bg-bad-soft px-4 py-3 text-sm font-medium text-bad">{error}</p> : null}
      <Button size="lg" type="submit" loading={busy} disabled={saved.isPending || (!saved.data && (!parsed.ok || over || !recipient.trim()))}>{!busy ? <Send /> : null}{saved.data ? "Continue payment" : parsed.ok && !over ? `Pay ${units(parsed.value)}` : "Pay"}</Button>
      {saved.data ? <Button variant="ghost" disabled={busy} onClick={()=>void (async()=>{try{if(saved.data?.approvalId){const current=await client!.approval(saved.data.approvalId);if(!["denied","cancelled","expired","executed"].includes(current.status))await client!.decideApproval(saved.data.approvalId,"cancel");}remember(null);setError(null);tracker.reset();}catch(error){setError(describeError(error,"This payment is already authorized. Continue it before starting another."));}})()}>Cancel request</Button> : null}
    </form>
  </section>;
}
