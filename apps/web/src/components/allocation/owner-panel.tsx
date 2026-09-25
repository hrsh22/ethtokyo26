"use client";

import { Ban, Plus, RotateCcw, AtSign } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AgentBudget } from "../allocate/agent-budget";
import { useAgentIdentities } from "../agent-identity";
import { toast } from "sonner";
import { getAddress, zeroAddress, type Hex } from "viem";
import { useAccord } from "@/lib/accord";
import { parseAmount } from "@/lib/amounts";
import { describeError } from "@/lib/errors";
import { formatUnits } from "viem";
import { useChainActions } from "@/lib/use-chain-actions";
import { useSponsoredTransaction } from "@/lib/use-sponsored-transaction";
import type { AllocationData } from "@/lib/use-allocation";
import { AmountField } from "../amount-field";
import { SharePanel } from "../share";
import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";

type Envelope = { spaceAddress: string; calldata: string; permit: { requestId: string } };

/** What the owner can do with one allocation: share it, set the agent's mandate, revoke, or close and recover. */
export function OwnerPanel({ address, draftId, data, label, decimals, symbol, units }: {
  address: string; draftId: string; data: AllocationData; label: string; decimals?: number; symbol: string; units: (value: bigint) => string;
}) {
  const { client, checkSession } = useAccord();
  const { requireWallet, sendPermitTransaction } = useChainActions(address);
  const sponsor = useSponsoredTransaction();
  const cache = useQueryClient(), router = useRouter();
  const identities = useAgentIdentities(draftId);
  const identity = identities.data?.identities.find(i => i.allocationId === data.id.toString());
  const [fundOpen, setFundOpen] = useState(false), [additional, setAdditional] = useState("100");
  const [confirm, setConfirm] = useState<"revoke" | "close" | null>(null);
  const [mandateOpen, setMandateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isAgent = data.allocation[0] === zeroAddress;
  const closed = data.allocation[6];
  const mandateOn = data.mandate[9];

  async function submit(envelope: Envelope) {
    return sendPermitTransaction(envelope.permit.requestId as Hex, () => sponsor.send(getAddress(envelope.spaceAddress), envelope.calldata as Hex));
  }

  async function act(kind: "revoke" | "close") {
    if (!client || busy) return;
    setBusy(true);
    try {
      requireWallet();
      const request = { draftId, requestKey: crypto.randomUUID(), allocationId: data.id.toString() };
      if (kind === "revoke") await client.revokeAgentIdentity(draftId, data.id.toString());
      else await submit(await client.recoverAllocation(request));
      await cache.invalidateQueries();
      toast.success(kind === "revoke" ? "ENS identity revoked. The agent can no longer pay." : `Closed. ${units(data.allocation[1])} is back in your wallet.`);
      setConfirm(null);
    } catch (cause) {
      checkSession(cause);
      toast.error(describeError(cause, kind === "revoke" ? "The ENS identity couldn't be revoked." : "The allocation couldn't be closed."));
    } finally { setBusy(false); }
  }

  if (closed) return <section className="card p-6 sm:p-7">
    <h2 className="font-display text-3xl font-extrabold">Closed</h2>
    <p className="mt-2 text-ink-soft">This allocation is closed and its unspent funds went back to you. Nobody can claim or pay from it again.</p>
  </section>;

  return <div className="grid grid-cols-1 gap-4">
    <section className="card p-6 sm:p-7" aria-labelledby="share-heading">
      <h2 id="share-heading" className="font-display text-3xl font-extrabold">{isAgent ? "Share with whoever runs the agent" : "Share a direct link"}</h2>
      <p className="mb-5 mt-1 text-muted">{isAgent ? "It shows the agent its limits and lets it pay from this budget." : `${label} will see this under Shared with you after signing in with their wallet. You can also send the link.`}</p>
      <SharePanel path={`/spaces/${address}/a/${data.id}`} />
    </section>
    <section className="card grid gap-3 p-6 sm:p-7" aria-labelledby="manage-heading">
      <h2 id="manage-heading" className="font-display text-2xl font-extrabold">Manage</h2>
      {isAgent ? <div className="flex flex-wrap items-center gap-3 rounded-3xl bg-soft p-4">
        <AtSign className="text-[#6f4bea]" />
        <span className="min-w-[180px] flex-1"><b className="block">ENS authority</b>
          <span className="text-sm text-muted">{identity?.active ? "The agent can spend within its approved limits." : "Authorize an active identity before the agent can spend."}</span></span>
        <Button variant={mandateOn ? "light" : "primary"} onClick={() => setMandateOpen(true)}>{mandateOn ? "Edit authority" : "Authorize agent"}</Button>
        {identity?.active ? <><Button variant="light" onClick={() => setFundOpen(true)}><Plus/>Add funds</Button><Button variant="danger" onClick={() => setConfirm("revoke")}><Ban/>Revoke ENS</Button></> : null}
      </div> : null}
      <div className="flex flex-wrap items-center gap-3 rounded-3xl bg-soft p-4">
        <RotateCcw className="text-[#2B7CC4]" />
        <span className="min-w-[180px] flex-1"><b className="block">Close and take back {units(data.allocation[1])}</b><span className="text-sm text-muted">Stops all future {isAgent ? "payments" : "claims"}. What’s already been {isAgent ? "paid" : "claimed"} stays final.</span></span>
        <Button variant="danger" onClick={() => setConfirm("close")}>Close</Button>
      </div>
    </section>

    <Sheet open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }} busy={busy}
      title={confirm === "revoke" ? "Revoke this ENS identity?" : `Close ${label}?`}
      description={confirm === "revoke" ? `Revoking ${identity?.name ?? "this name"} blocks future payments, including payments already approved by you. The remaining budget stays in the Space.` : `${units(data.allocation[1])} returns to your wallet. This can't be undone.`}>
      <div className="flex justify-end gap-2">
        <Button variant="soft" disabled={busy} onClick={() => setConfirm(null)}>Keep it</Button>
        <Button variant="danger" loading={busy} onClick={() => void act(confirm!)}>{confirm === "revoke" ? "Revoke ENS identity" : "Close and recover"}</Button>
      </div>
    </Sheet>
    {isAgent ? <Sheet open={mandateOpen} onOpenChange={setMandateOpen} title="Agent authority" description="Keep the ENS identity, spending limits, and human approval policy together.">
      <AgentBudget address={address} draftId={draftId} allocationId={data.id.toString()} defaults={identity ? {
        label: identity.revoked ? "research-new" : identity.name.split(".")[0]!, agent: identity.agent,
        daily: formatUnits(data.mandate[4], decimals ?? 6), per: formatUnits(data.mandate[5], decimals ?? 6),
        threshold: formatUnits(BigInt(identity.approvalThreshold), decimals ?? 6),
        ends: new Date(Number(data.mandate[8]) * 1000).toISOString().slice(0,10),
      } : undefined}/>
    </Sheet> : null}
    <Sheet open={fundOpen} onOpenChange={setFundOpen} busy={busy} title="Increase the agent budget" description="Review this increase with a fresh World ID check.">
      <form className="grid gap-4" onSubmit={event => {event.preventDefault();void (async()=>{
        if(!client || busy)return;
        const amount=parseAmount(additional,decimals,"Amount");if(!amount.ok){toast.error(amount.error);return;}
        setBusy(true);try{const request=await client.fundAgent({draftId,allocationId:data.id.toString(),amount:amount.value.toString(),requestKey:crypto.randomUUID()});router.push(`/approvals/${request.id}`);}
        catch(error){checkSession(error);toast.error(describeError(error,"The increase could not be prepared."));}finally{setBusy(false);}
      })();}}><AmountField id="add-agent-funds" label="Add to budget" value={additional} onChange={setAdditional} symbol={symbol}/><Button type="submit" loading={busy}>Review increase</Button></form>
    </Sheet>
  </div>;
}
