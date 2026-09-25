"use client";

import { spaceAccountAbi } from "@accord/chain";
import type { AccordClient } from "@accord/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "motion/react";
import { Check, Fingerprint, Globe, Link2 } from "lucide-react";
import { useMemo, useState } from "react";
import { formatUnits, getAddress, type Hex } from "viem";
import { toast } from "sonner";
import { useWriteContract } from "wagmi";
import { WorldSession } from "@/components/world-session";
import { SEPOLIA_CHAIN_ID, useAccord } from "@/lib/accord";
import { parseAmount } from "@/lib/amounts";
import { describeError } from "@/lib/errors";
import { shortAddress } from "@/lib/format";
import type { Palette } from "@/lib/palette";
import { explorerTx, permitFrom, useChainActions } from "@/lib/use-chain-actions";
import type { AllocationData } from "@/lib/use-allocation";
import { AmountField } from "../amount-field";
import { TxTracker, useSteps } from "../tx-tracker";
import { Button } from "../ui/button";

type Challenge = Awaited<ReturnType<AccordClient["worldChallenge"]>>;
type Intent = Awaited<ReturnType<AccordClient["prepareClaim"]>>;

/** The recipient's claim: link World ID once, then a fresh World check and one wallet prompt per claim. */
export function ClaimPanel({ address, draftId, data, decimals, symbol, units, palette }: {
  address: string; draftId: string; data: AllocationData; decimals?: number; symbol: string; units: (value: bigint) => string; palette: Palette;
}) {
  const { client, account, checkSession } = useAccord();
  const cache = useQueryClient();
  const { requireWallet, sendPermitTransaction } = useChainActions(address);
  const { writeContractAsync } = useWriteContract();
  const world = useQuery({ queryKey: ["world-status", account], queryFn: () => client!.worldStatus(), enabled: !!client, retry: false });
  const available = data.window.available;
  const [value, setValue] = useState(() => decimals === undefined ? "" : formatUnits(available, decimals));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The widget stays mounted after it closes: IDKit may report success after its dialog closes.
  const [challenge, setChallenge] = useState<{ kind: "enroll" | "claim"; challenge: Challenge; intent?: Intent } | null>(null);
  const [worldOpen, setWorldOpen] = useState(false);
  const [claimed, setClaimed] = useState<{ amount: bigint; hash: Hex | null } | null>(null);
  const initial = useMemo(() => [
    { id: "prepare", label: "Check the claim" },
    { id: "world", label: "Fresh World ID check" },
    { id: "wallet", label: "Confirm in your wallet" },
  ], []);
  const tracker = useSteps(initial);
  const parsed = parseAmount(value, decimals, "Amount");
  const over = parsed.ok && parsed.value > available;

  async function link() {
    if (!client || busy) return;
    setBusy(true); setError(null);
    try { setChallenge({ kind: "enroll", challenge: await client.worldChallenge(world.data?.enrolled ? "reverify" : "enroll") }); setWorldOpen(true); }
    catch (cause) { checkSession(cause); setError("Couldn't start a World ID check. Try again."); }
    finally { setBusy(false); }
  }

  async function begin() {
    if (!client || busy || !parsed.ok || over) return;
    setBusy(true); setError(null); tracker.reset();
    try {
      requireWallet();
      const intent = await tracker.run("prepare", "Checking your limits", () => client.prepareClaim({
        draftId, allocationId: data.id.toString(), amount: parsed.value.toString(), requestKey: crypto.randomUUID() }));
      tracker.update("world", { state: "active", detail: "Scan with World App" });
      const next = await client.worldChallenge("claim", intent.id);
      if (!next.signal) throw new Error("World ID didn't return the claim-bound signal. Try again.");
      setChallenge({ kind: "claim", challenge: next, intent });
      setWorldOpen(true);
    } catch (cause) {
      checkSession(cause);
      tracker.update("world", { state: "waiting", detail: undefined });
      setError(describeError(cause, "The claim couldn't start."));
      setBusy(false);
    }
  }

  async function complete(intent: Intent) {
    setBusy(true);
    tracker.update("world", { state: "done", detail: undefined });
    try {
      const hash = await tracker.run("wallet", "Confirm in your wallet", async () => {
        const signed = await client!.signClaim(intent.id);
        if (!signed.signature) throw new Error("The claim couldn't be authorized. Start a fresh claim.");
        return sendPermitTransaction(signed.permit.requestId as Hex, () => writeContractAsync({
          address: getAddress(signed.spaceAddress), abi: spaceAccountAbi, functionName: "claim", chainId: SEPOLIA_CHAIN_ID,
          args: [BigInt(signed.permit.allocationId), BigInt(signed.permit.amount), permitFrom(signed), signed.signature as Hex],
        }));
      });
      setClaimed({ amount: BigInt(intent.permit.amount), hash });
      void confetti({ particleCount: 120, spread: 80, origin: { y: 0.35 }, colors: [palette.ring[0], palette.ring[1], "#C4F26A", "#A98BFF"], disableForReducedMotion: true });
    } catch (cause) {
      checkSession(cause);
      setError(describeError(cause, "The verified claim couldn't be sent."));
    } finally { setBusy(false); }
  }

  const enrolled = world.data?.enrolled;
  return <section className="card p-6 sm:p-7" aria-labelledby="claim-heading">
    <AnimatePresence mode="wait" initial={false}>
      {claimed ? <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="py-4 text-center">
        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 12, delay: 0.1 }}
          className="orb mx-auto mb-5 grid size-24 place-items-center" style={{ "--orb-hi": "#F4FFD9", "--orb": "#C4F26A", "--orb-lo": "#8BC51F" } as React.CSSProperties}>
          <Check size={44} strokeWidth={2.6} className="text-[#243300]" />
        </motion.span>
        <h2 id="claim-heading" className="font-display text-5xl font-extrabold leading-none">+{units(claimed.amount)}</h2>
        <p className="mt-2 text-ink-soft">It’s in your wallet, {account ? shortAddress(account) : ""}.</p>
        <div className="mx-auto mt-6 grid max-w-sm gap-2 rounded-3xl bg-soft p-4 text-left text-sm">
          <div className="flex justify-between"><span className="text-muted">World ID</span><b>Verified</b></div>
          <div className="flex justify-between"><span className="text-muted">Transaction</span>{claimed.hash ? explorerTx(claimed.hash)
            ? <a className="font-semibold text-[#6f4bea]" href={explorerTx(claimed.hash)} target="_blank" rel="noreferrer">View receipt</a> : <b className="address">{shortAddress(claimed.hash)}</b> : <b>Confirmed onchain</b>}</div>
        </div>
        <Button variant="soft" className="mt-6" onClick={() => { setClaimed(null); tracker.reset(); setValue(""); void cache.invalidateQueries({ queryKey: ["allocation", address] }); }}>Done</Button>
      </motion.div>

      : <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <h2 id="claim-heading" className="font-display text-3xl font-extrabold">Claim</h2>
        <p className="mt-1 text-muted">Goes to your wallet, <span className="address">{account ? shortAddress(account) : ""}</span>.</p>

        {world.isPending ? <div className="mt-5 h-20 animate-pulse rounded-3xl bg-soft" />
          : world.data && !world.data.configured ? <p className="mt-5 rounded-2xl bg-warn-soft px-4 py-3 text-sm font-medium text-warn">World ID isn’t configured on this Accord deployment, so claims are off.</p>
          : !enrolled ? <div className="mt-5 flex flex-wrap items-center gap-4 rounded-3xl p-4" style={{ background: palette.soft }}>
            <span className="grid size-12 place-items-center rounded-2xl bg-white"><Fingerprint /></span>
            <span className="min-w-[180px] flex-1"><b className="block">First, link World ID</b><span className="text-sm text-ink-soft">A one-time check that ties you to this wallet. Each claim then asks for a quick fresh check.</span></span>
            <Button onClick={() => void link()} loading={busy}><Link2 />Link World ID</Button>
          </div>
          : <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-good"><Check size={16} strokeWidth={3} />World ID linked to this wallet</div>}

        <div className="mt-5"><AmountField id="claim-amount" label="Amount" value={value} onChange={(next) => { setValue(next); setError(null); }} symbol={symbol}
          quick={available > BigInt(0) && decimals !== undefined ? [formatUnits(available, decimals)] : undefined} quickLabel={(item) => `Max ${item}`} /></div>
        {over ? <p role="alert" className="mt-2 text-sm font-medium text-bad">You can claim up to {units(available)} right now.</p> : null}

        {tracker.steps.some((step) => step.state !== "waiting") ? <div className="mt-5"><TxTracker steps={tracker.steps} /></div> : null}
        {error ? <p role="alert" className="mt-4 rounded-2xl bg-bad-soft px-4 py-3 text-sm font-medium text-bad">{error}</p> : null}

        <Button size="lg" className="mt-6 w-full" loading={busy} disabled={!enrolled || available === BigInt(0) || !parsed.ok || over} onClick={() => void begin()}>
          {!busy ? <Globe /> : null}{available === BigInt(0) ? "Nothing to claim right now" : parsed.ok && !over ? `Verify and claim ${units(parsed.value)}` : "Verify and claim"}
        </Button>
        <p className="mt-3 text-center text-sm text-muted">The owner can close this allocation and take back what you haven’t claimed.</p>
      </motion.div>}
    </AnimatePresence>

    {challenge ? <WorldSession
      open={worldOpen}
      onOpenChange={(open) => {
        setWorldOpen(open);
        if (!open && challenge.kind === "claim" && tracker.steps.find((step) => step.id === "world")?.state === "active") {
          setBusy(false); tracker.update("world", { state: "waiting", detail: undefined });
        }
      }}
      app_id={challenge.challenge.appId as `app_${string}`}
      rp_context={challenge.challenge.rpContext}
      environment={challenge.challenge.environment}
      existing_session_id={challenge.challenge.sessionId as `session_${string}` | undefined}
      require_user_presence={challenge.challenge.requireUserPresence}
      constraints={{ type: "selfie", ...(challenge.challenge.signal ? { signal: challenge.challenge.signal } : {}) }}
      handleVerify={(result) => client!.worldVerify(challenge.challenge.id, result).then(() => undefined)}
      onSuccess={() => {
        setWorldOpen(false);
        if (challenge.kind === "enroll") { toast.success("World ID linked to this wallet"); void cache.invalidateQueries({ queryKey: ["world-status"] }); return; }
        void complete(challenge.intent!);
      }}
      onError={() => {
        setWorldOpen(false);
        setError(challenge.kind === "claim" ? "World ID verification didn't finish. Start a fresh claim to retry." : "World ID linking didn't finish. Try again.");
        if (challenge.kind === "claim") { setBusy(false); tracker.update("world", { state: "error", detail: undefined }); }
      }}
    /> : null}
  </section>;
}
