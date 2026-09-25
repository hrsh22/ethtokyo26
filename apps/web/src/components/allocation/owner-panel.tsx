"use client";

import type { AccordClient } from "@accord/sdk";
import { Ban, RotateCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getAddress, zeroAddress, type Hex } from "viem";
import { useAccord } from "@/lib/accord";
import { parseAmount } from "@/lib/amounts";
import { describeError, tagOf } from "@/lib/errors";
import { formatUnits } from "viem";
import { shortDate } from "@/lib/format";
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
      await submit(kind === "revoke" ? await client.revokeMandate(request) : await client.recoverAllocation(request));
      toast.success(kind === "revoke" ? "Mandate revoked. The agent can't pay from this budget any more." : `Closed. ${units(data.allocation[1])} is back in your wallet.`);
      setConfirm(null);
    } catch (cause) {
      checkSession(cause);
      toast.error(describeError(cause, kind === "revoke" ? "The mandate couldn't be revoked." : "The allocation couldn't be closed."));
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
        <ShieldCheck className="text-[#6f4bea]" />
        <span className="min-w-[180px] flex-1"><b className="block">{mandateOn ? "Mandate active" : "No mandate yet"}</b>
          <span className="text-sm text-muted">{mandateOn ? `${units(data.mandate[4])} a day, ${units(data.mandate[5])} each, until ${shortDate(data.mandate[8])}${data.ensAuthorized ? "" : ". ENS authority has lapsed"}` : "The agent can't pay until you grant one."}</span></span>
        <Button variant={mandateOn ? "light" : "primary"} onClick={() => setMandateOpen(true)}>{mandateOn ? "Edit limits" : "Grant mandate"}</Button>
        {mandateOn ? <Button variant="danger" onClick={() => setConfirm("revoke")}><Ban />Revoke</Button> : null}
      </div> : null}
      <div className="flex flex-wrap items-center gap-3 rounded-3xl bg-soft p-4">
        <RotateCcw className="text-[#2B7CC4]" />
        <span className="min-w-[180px] flex-1"><b className="block">Close and take back {units(data.allocation[1])}</b><span className="text-sm text-muted">Stops all future {isAgent ? "payments" : "claims"}. What’s already been {isAgent ? "paid" : "claimed"} stays final.</span></span>
        <Button variant="danger" onClick={() => setConfirm("close")}>Close</Button>
      </div>
    </section>

    <Sheet open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }} busy={busy}
      title={confirm === "revoke" ? "Revoke the mandate?" : `Close ${label}?`}
      description={confirm === "revoke" ? "The agent stops being able to pay straight away, including with permits it already has." : `${units(data.allocation[1])} returns to your wallet. This can't be undone.`}>
      <div className="flex justify-end gap-2">
        <Button variant="soft" disabled={busy} onClick={() => setConfirm(null)}>Keep it</Button>
        <Button variant="danger" loading={busy} onClick={() => void act(confirm!)}>{confirm === "revoke" ? "Revoke mandate" : "Close and recover"}</Button>
      </div>
    </Sheet>
    {isAgent ? <MandateSheet open={mandateOpen} onOpenChange={setMandateOpen} address={address} draftId={draftId} data={data}
      decimals={decimals} symbol={symbol} submit={submit} /> : null}
  </div>;
}

type EnsName = Awaited<ReturnType<AccordClient["resolveEnsName"]>>;
const dayInput = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

function MandateSheet({ open, onOpenChange, address, draftId, data, decimals, symbol, submit }: {
  open: boolean; onOpenChange: (open: boolean) => void; address: string; draftId: string; data: AllocationData;
  decimals?: number; symbol: string; submit: (envelope: Envelope) => Promise<Hex | null>;
}) {
  const { client, config, checkSession } = useAccord();
  const { requireWallet } = useChainActions(address);
  const fmt = (value: bigint) => decimals === undefined || value === BigInt(0) ? "" : formatUnits(value, decimals);
  const [ens, setEns] = useState("");
  const [daily, setDaily] = useState(() => fmt(data.mandate[4]) || "20");
  const [perPayment, setPerPayment] = useState(() => fmt(data.mandate[5]) || "5");
  const [ends, setEnds] = useState(() => dayInput(data.mandate[9] ? Number(data.mandate[8]) : Math.floor(Date.now() / 1000) + 14 * 86_400));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dailyParsed = parseAmount(daily, decimals, "Daily cap");
  const perParsed = parseAmount(perPayment, decimals, "Per payment");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!client || busy) return;
    if (!dailyParsed.ok) { setError(dailyParsed.error); return; }
    if (!perParsed.ok) { setError(perParsed.error); return; }
    if (perParsed.value > dailyParsed.value) { setError("Per payment can't be more than the daily cap."); return; }
    setBusy(true); setError(null);
    try {
      requireWallet();
      const registry = config.data?.ensRegistryAddress;
      if (!registry) throw new Error("The trusted ENS registry isn't configured.");
      const text = ens.trim();
      let name: EnsName;
      try { name = await client.resolveEnsName(text.endsWith(".eth") ? text : `${text}.eth`); }
      catch (cause) { throw new Error(tagOf(cause) === "NotFound" ? "That ENS name wasn't found on Sepolia." : "Enter the agent's .eth name, like research.eth."); }
      if (!name.active || name.registry.toLowerCase() !== registry.toLowerCase()) throw new Error(`${name.name} isn't active in the ENS registry Accord trusts.`);
      const expiry = Math.floor(Date.parse(`${ends}T23:59:59`) / 1000);
      if (!Number.isFinite(expiry) || expiry * 1000 <= Date.now()) throw new Error("Pick an end date after today.");
      if (expiry >= Number(name.expiry)) throw new Error(`Must end before ${name.name} expires on ${shortDate(Number(name.expiry))}.`);
      await submit(await client.setMandate({ draftId, requestKey: crypto.randomUUID(), allocationId: data.id.toString(), agent: getAddress(name.owner),
        registry: getAddress(registry), nameId: name.nameId, expectedResource: name.resource, dailyCap: dailyParsed.value.toString(),
        maxPerPayment: perParsed.value.toString(), expiry: String(expiry), agentEnsName: name.name }));
      toast.success(`Mandate set for ${name.name}`);
      onOpenChange(false);
    } catch (cause) {
      checkSession(cause);
      setError(describeError(cause, "The mandate couldn't be set."));
    } finally { setBusy(false); }
  }

  return <Sheet open={open} onOpenChange={onOpenChange} busy={busy} title={data.mandate[9] ? "Edit the mandate" : "Grant a mandate"}
    description="The agent pays under its ENS name, within these limits. The wallet is read from the name.">
    <form className="grid gap-4" onSubmit={(event) => void save(event)}>
      <div><label htmlFor="mandate-ens" className="font-semibold">Agent’s ENS name</label>
        <input id="mandate-ens" data-autofocus className="field mt-2" value={ens} onChange={(event) => setEns(event.target.value)} placeholder="research.eth" required autoComplete="off" spellCheck={false} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <AmountField id="mandate-daily" label="Daily cap" value={daily} onChange={setDaily} symbol={symbol} />
        <AmountField id="mandate-per" label="Max per payment" value={perPayment} onChange={setPerPayment} symbol={symbol} />
      </div>
      <div><label htmlFor="mandate-ends" className="font-semibold">Ends</label>
        <input id="mandate-ends" type="date" className="field mt-2" value={ends} onChange={(event) => setEnds(event.target.value)} /></div>
      {error ? <p role="alert" className="rounded-2xl bg-bad-soft px-4 py-3 text-sm font-medium text-bad">{error}</p> : null}
      <Button size="lg" type="submit" loading={busy}>Save mandate</Button>
      <p className="text-center text-sm text-muted">One wallet prompt. Existing limits are replaced.</p>
    </form>
  </Sheet>;
}
