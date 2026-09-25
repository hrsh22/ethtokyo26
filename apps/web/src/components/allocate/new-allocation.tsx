"use client";

import { spaceAccountAbi } from "@accord/chain";
import type { AccordClient } from "@accord/sdk";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, AtSign, Ban, Bot, Check, Lock, ScanLine, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { encodeFunctionData, formatUnits, getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { useAccord } from "@/lib/accord";
import { parseAmount } from "@/lib/amounts";
import { describeError, tagOf } from "@/lib/errors";
import { amount, shortAddress, shortDate } from "@/lib/format";
import { allocationPalette } from "@/lib/palette";
import { allocationTerms, maxClaimable, runLabel, runPresets, type Frequency, type Terms } from "@/lib/schedule";
import { useChainActions } from "@/lib/use-chain-actions";
import { useSponsoredTransaction } from "@/lib/use-sponsored-transaction";
import { useSpace } from "@/lib/use-space";
import { AmountField } from "../amount-field";
import { Avatar } from "../avatar";
import { SharePanel } from "../share";
import { SignInCard } from "../sign-in-card";
import { TxTracker, useSteps } from "../tx-tracker";
import { Button } from "../ui/button";

type Kind = "person" | "agent";
type EnsName = Awaited<ReturnType<AccordClient["resolveEnsName"]>>;
type Draft = Awaited<ReturnType<AccordClient["lookupSpace"]>>;
type Person = { address: Address; ensName?: string };

const erc20ApproveAbi = [{ type: "function", name: "approve", stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }] as const;
const frequencies = [["once", "All at once"], ["day", "Every day"], ["month", "Every month"], ["minute", "Every minute"]] as const;
const chip = (selected: boolean) => `rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40 ${selected ? "bg-ink text-white" : "bg-soft hover:bg-[#ebe9f3]"}`;
const dayInput = (date: Date) => date.toISOString().slice(0, 10);

export function NewAllocation({ address }: { address: string }) {
  const { auth } = useAccord();
  const space = useSpace(address);
  const params = useSearchParams();
  const back = <Link href={`/spaces/${address}`} className="mb-6 inline-flex items-center gap-2 font-semibold text-muted hover:text-ink"><ArrowLeft size={18} />{space.draft.data?.name ?? "Back to Space"}</Link>;
  const frame = (children: React.ReactNode) => <div className="mx-auto max-w-[720px]">{back}{children}</div>;
  if (!auth.signedIn) return frame(<SignInCard title="Sign in to add a budget" body="Only the Space owner can add people and agents. Sign in with the owner wallet." />);
  if (space.meta.isPending || space.draft.isPending) return frame(<div className="h-96 animate-pulse rounded-tile bg-white/70" />);
  if (!space.isOwner) return frame(<div className="card p-8"><h1 className="font-display text-3xl font-extrabold">Only the owner can do this</h1><p className="mt-2 text-ink-soft">This Space belongs to {space.meta.data ? shortAddress(space.meta.data.owner) : "another wallet"}. Switch to that wallet to add a budget.</p></div>);
  if (!space.draft.data) return frame(<div className="card p-8"><h1 className="font-display text-3xl font-extrabold">This Space isn’t linked to Accord here</h1><p className="mt-2 text-ink-soft">It exists onchain, but this Accord deployment has no record of it, so it can’t sign new budgets.</p></div>);
  const initial: Kind = params.get("for") === "agent" ? "agent" : "person";
  return frame(<Flow address={address} draft={space.draft.data} initialKind={initial} decimals={space.decimals} symbol={space.symbol}
    nextId={(space.terms.data?.count ?? BigInt(0)) + BigInt(1)} />);
}

function Flow({ address, draft, initialKind, decimals, symbol, nextId }: {
  address: string; draft: Draft; initialKind: Kind; decimals?: number; symbol: string; nextId: bigint;
}) {
  const { client, config, checkSession } = useAccord();
  const { chain } = useChainActions(address);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [step, setStep] = useState<"who" | "budget" | "review" | "done">("who");
  const [input, setInput] = useState("");
  const [resolving, setResolving] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const [agent, setAgent] = useState<EnsName | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [whoError, setWhoError] = useState<string | null>(null);
  const [total, setTotal] = useState("100");
  const [frequency, setFrequency] = useState<Frequency>("day");
  // Intervals the allowance runs for; null runs until the total is used or the owner closes it.
  const [runFor, setRunFor] = useState<number | null>(null);
  const [cap, setCap] = useState("10");
  const [daily, setDaily] = useState("20");
  const [perPayment, setPerPayment] = useState("5");
  // Captured once so render stays pure; the chain checks expiry against its own clock anyway.
  const [openedAt] = useState(() => Date.now());
  const [ends, setEnds] = useState(() => dayInput(new Date(openedAt + 14 * 86_400_000)));
  const [result, setResult] = useState<{ id: string; mandate: boolean } | null>(null);
  const palette = allocationPalette(result ? BigInt(result.id) : nextId, kind === "agent");
  const scheduleSupport = useQuery({
    queryKey: ["schedule-support", address], enabled: !!chain, retry: false, staleTime: Infinity,
    queryFn: () => chain!.readContract({ address: getAddress(address), abi: spaceAccountAbi, functionName: "allocationScheduleVersion" }).catch(() => BigInt(0)),
  });

  function switchKind(next: Kind) {
    if (next === kind) return;
    setKind(next); setPerson(null); setAgent(null); setConfirmed(false); setWhoError(null); setInput("");
  }

  function pickFrequency(next: Frequency) {
    setFrequency(next);
    setRunFor(next === "minute" ? 5 : null);
  }

  async function resolve() {
    const value = input.trim();
    if (!value || resolving || !client) return;
    setResolving(true); setWhoError(null); setPerson(null); setAgent(null); setConfirmed(false);
    try {
      if (kind === "person") {
        if (value.startsWith("0x")) {
          if (!isAddress(value) || value.toLowerCase() === zeroAddress) throw new Error("That isn't a valid wallet address.");
          setPerson({ address: getAddress(value) });
        } else {
          const found = await client.resolveEnsRecipient(value);
          setPerson({ address: getAddress(found.address), ensName: found.name });
        }
      } else {
        const name = await client.resolveEnsName(value.endsWith(".eth") ? value : `${value}.eth`);
        const registry = config.data?.ensRegistryAddress;
        if (!registry) throw new Error("This Accord deployment has no ENS registry configured.");
        if (!name.active) throw new Error(`${name.name} isn't actively registered. Renew it or pick another name.`);
        if (name.registry.toLowerCase() !== registry.toLowerCase()) throw new Error(`${name.name} is in a different ENS registry than the one Accord trusts.`);
        setAgent(name);
        const nameEnds = new Date(Number(name.expiry) * 1000 - 86_400_000);
        if (new Date(ends) > nameEnds) setEnds(dayInput(nameEnds));
      }
    } catch (cause) {
      const tag = tagOf(cause);
      setWhoError(tag === "NotFound" ? kind === "person" ? "That name has no wallet on Sepolia. Try another name or paste the address." : "That ENS name wasn't found on Sepolia."
        : tag === "BadRequest" ? kind === "person" ? "Enter a .eth name or a wallet address." : "Enter the agent's .eth name, like research.eth."
        : cause instanceof Error && !tag ? cause.message : "ENS couldn't be reached. Try again in a moment.");
    } finally { setResolving(false); }
  }

  const totalParsed = parseAmount(total, decimals, "Total");
  const timed = scheduleSupport.data === BigInt(1);
  const picked = allocationTerms(frequency, runFor);
  const terms: Terms = "error" in picked ? { period: 1 } : picked;
  const capParsed = frequency === "once" ? totalParsed : parseAmount(cap, decimals, "Limit");
  const dailyParsed = parseAmount(daily, decimals, "Daily cap");
  const perParsed = parseAmount(perPayment, decimals, "Per payment");
  const endsAt = Math.floor(Date.parse(`${ends}T23:59:59`) / 1000);
  const endsError = kind !== "agent" ? null : !Number.isFinite(endsAt) || endsAt * 1000 <= openedAt ? "Pick a date after today."
    : agent && endsAt >= Number(agent.expiry) ? `Must end before the ENS name expires on ${shortDate(Number(agent.expiry))}.` : null;
  const budgetError = !totalParsed.ok ? totalParsed.error : kind === "person" ? !capParsed.ok ? capParsed.error
      : capParsed.value > totalParsed.value ? "The limit can't be more than the total." : "error" in picked ? picked.error
      : terms.schedule && !timed ? "This Space can't run timed allowances. Create a new Space to use them." : null
    : !dailyParsed.ok ? dailyParsed.error : !perParsed.ok ? perParsed.error
    : perParsed.value > dailyParsed.value ? "Per payment can't be more than the daily cap." : endsError;
  const units = (value: bigint) => amount(value, decimals, symbol);
  const who = kind === "person" ? person?.ensName ?? (person ? shortAddress(person.address) : "") : agent?.name ?? "";
  const sentence = !totalParsed.ok ? "" : kind === "person"
    ? frequency === "once" ? `${who} can claim ${units(totalParsed.value)} whenever they like, with a World ID check each time.`
      : capParsed.ok ? `${who} can claim up to ${units(capParsed.value)} a ${frequency} from ${units(totalParsed.value)}${runLabel(frequency, runFor) ? ` for ${runLabel(frequency, runFor)}` : ""}, with a World ID check each time.` : ""
    : dailyParsed.ok && perParsed.ok ? `${who} can pay screened recipients up to ${units(perParsed.value)} at a time and ${units(dailyParsed.value)} a day, from ${units(totalParsed.value)}, until ${shortDate(endsAt)}.` : "";
  const lasts = totalParsed.ok && capParsed.ok && frequency !== "once" ? Number((totalParsed.value + capParsed.value - BigInt(1)) / capParsed.value) : null;
  const most = capParsed.ok ? maxClaimable(terms, capParsed.value) : undefined;
  const windows = terms.schedule ? terms.schedule.durationSeconds / terms.schedule.intervalSeconds : null;
  const plural = (count: number) => `${count} ${frequency}${count === 1 ? "" : "s"}`;
  const order = ["who", "budget", "review"] as const;

  return <section className="card overflow-hidden" aria-labelledby="allocate-title">
    <div className="relative overflow-hidden px-7 pb-7 pt-8 sm:px-9" style={{ background: palette.tile, color: palette.ink }}>
      <div className="blob -right-16 -top-24 size-64 opacity-70" style={{ background: palette.soft }} />
      <div className="relative flex flex-wrap gap-2">{order.map((item, index) => <span key={item} className={`pill ${step === item ? "bg-ink text-white" : order.indexOf(step as typeof order[number]) > index || step === "done" ? "bg-white/80" : "bg-white/40"}`}>
        {order.indexOf(step as typeof order[number]) > index || step === "done" ? <Check size={14} strokeWidth={3} /> : null}{["Who", "Budget", "Fund"][index]}
      </span>)}</div>
      <div className="relative mt-6 flex items-center gap-4">
        <motion.div key={kind} initial={{ scale: 0.6, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 14 }}>
          <Avatar kind={kind} palette={palette} size={64} />
        </motion.div>
        <div className="min-w-0">
          <h1 id="allocate-title" className="truncate font-display text-[40px] font-extrabold leading-none tracking-[-0.03em]">
            {step === "done" ? "It's live" : who || (kind === "person" ? "Give a person a budget" : "Give an agent a budget")}
          </h1>
          <p className="mt-1 opacity-75">{step === "who" ? kind === "person" ? "Who is it for?" : "Which agent?" : step === "budget" ? "How much, and how often?" : step === "review" ? "Check it, then fund it." : "The contract now enforces these rules."}</p>
        </div>
      </div>
    </div>
    <div className="p-7 sm:p-9">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }}>
          {step === "who" ? <div>
            <div role="radiogroup" aria-label="Who is it for" className="inline-flex rounded-full bg-soft p-1">
              {(["person", "agent"] as const).map((item) => <button key={item} role="radio" aria-checked={kind === item} onClick={() => switchKind(item)}
                className={`flex items-center gap-2 rounded-full px-5 py-2.5 font-semibold transition-colors ${kind === item ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>
                {item === "person" ? <UserRound size={17} /> : <Bot size={17} />}{item === "person" ? "A person" : "An agent"}
              </button>)}
            </div>
            <form className="mt-6" onSubmit={(event) => { event.preventDefault(); void resolve(); }}>
              <label htmlFor="who" className="font-semibold">{kind === "person" ? "Their ENS name or wallet address" : "Your agent's ENS name"}</label>
              <div className="mt-2 flex gap-2">
                <input id="who" className="field text-lg" autoFocus value={input} placeholder={kind === "person" ? "kenji.eth or 0x…" : "research.eth"}
                  autoComplete="off" spellCheck={false} aria-invalid={!!whoError} aria-describedby="who-help"
                  onChange={(event) => { setInput(event.target.value); setPerson(null); setAgent(null); setConfirmed(false); setWhoError(null); }} />
                <Button type="submit" variant="soft" className="h-[54px]" loading={resolving} disabled={!input.trim()}>Look up</Button>
              </div>
              <p id="who-help" className="mt-2 text-sm text-muted">{kind === "person" ? "Names resolve on Sepolia. The wallet is fixed at setup, even if the name changes later."
                : "The agent acts under this ENSv2 name. If the name changes hands, its mandate stops working."}</p>
            </form>
            {whoError ? <p role="alert" className="mt-4 rounded-2xl bg-bad-soft px-4 py-3 text-sm font-medium text-bad">{whoError}</p> : null}
            <AnimatePresence>
              {person || agent ? <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mt-5 rounded-3xl p-4" style={{ background: palette.soft }}>
                <div className="flex items-center gap-3">
                  <Avatar kind={kind} palette={palette} size={48} />
                  <span className="min-w-0 flex-1"><b className="block truncate text-lg">{who}</b>
                    <span className="address block truncate text-sm text-muted">{person?.address ?? agent?.owner}</span></span>
                  <span className="pill bg-white">{kind === "person" ? person?.ensName ? "ENS on Sepolia" : "Wallet" : `Valid until ${shortDate(Number(agent!.expiry))}`}</span>
                </div>
                <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl bg-white px-4 py-3 font-medium">
                  <input type="checkbox" className="size-5 accent-[#16122b]" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                  {kind === "person" ? `This is ${person?.ensName ?? "their"} wallet` : "This is my agent's wallet"}
                </label>
              </motion.div> : null}
            </AnimatePresence>
            <p className="mt-4 text-sm text-muted">{kind === "person" ? "They'll verify with World ID on every claim. An ENS name alone doesn't prove a human." : "Every payment is also screened by Intercepta before it's signed."}</p>
            <div className="mt-7 flex justify-end"><Button size="lg" disabled={!confirmed || !(person || agent)} onClick={() => setStep("budget")}>Continue</Button></div>
          </div>

          : step === "budget" ? <div className="grid gap-6">
            <AmountField id="total" label={kind === "person" ? "How much in total?" : "Total budget"} value={total} onChange={setTotal} symbol={symbol} big quick={["25", "50", "100", "250"]} />
            {kind === "person" ? <>
              <fieldset>
                <legend className="font-semibold">How often can they claim?</legend>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {frequencies.map(([value, text]) => <button key={value} type="button" role="radio" aria-checked={frequency === value}
                    disabled={value === "minute" && !timed} onClick={() => pickFrequency(value)}
                    className={`rounded-[1.1rem] px-3 py-3.5 text-sm font-semibold transition-shadow disabled:opacity-40 ${frequency === value ? "shadow-[inset_0_0_0_2px_var(--color-ink)]" : "bg-soft"}`}
                    style={frequency === value ? { background: palette.soft } : undefined}>{text}</button>)}
                </div>
                {scheduleSupport.isSuccess && !timed ? <p className="mt-2 text-sm text-muted">This Space was created before timed allowances, so it can’t do per-minute claims or end dates. <Link href="/spaces/new" className="font-semibold text-ink underline">Create a new Space</Link> to use them.</p> : null}
              </fieldset>
              {frequency !== "once" ? <AmountField id="cap" label={`Up to, each ${frequency}`} value={cap} onChange={setCap} symbol={symbol} quick={["1", "5", "10", "20"]} /> : null}
              {frequency === "minute" || frequency === "day" ? <fieldset>
                <legend className="font-semibold">For how long?</legend>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {frequency === "day" ? <button type="button" className={chip(runFor === null)} onClick={() => setRunFor(null)}>No end date</button> : null}
                  {runPresets[frequency].map((preset) => <button key={preset.count} type="button" disabled={!timed} className={chip(runFor === preset.count)}
                    onClick={() => setRunFor(preset.count)}>{preset.label}</button>)}
                  <label className="flex items-center gap-2 text-sm font-semibold text-muted">
                    <input type="number" min={1} step={1} inputMode="numeric" disabled={!timed} placeholder="Custom" aria-label={`Number of ${frequency}s`}
                      value={runFor ?? ""} onChange={(event) => setRunFor(event.target.value === "" ? null : Number(event.target.value))}
                      className="field w-28 py-2 text-base text-ink disabled:opacity-40" />{frequency}s
                  </label>
                </div>
              </fieldset> : null}
              <p className="text-sm text-muted">{frequency === "once" ? "They can claim everything at once, or a bit at a time."
                : windows && most !== undefined && totalParsed.ok ? <>
                  Starts when funding confirms and ends after {runLabel(frequency, runFor)}, so at most {units(most)} can be claimed.
                  {lasts !== null && lasts < windows ? ` At the full rate, the total runs out after ${plural(lasts)}.` : ""}
                  {totalParsed.value > most ? <> The other {units(totalParsed.value - most)} stays reserved until you close it.{decimals !== undefined
                    ? <> <button type="button" className="font-semibold text-ink underline" onClick={() => setTotal(formatUnits(most, decimals))}>Set the total to {units(most)}</button></> : null}</> : ""}
                  {frequency === "minute" ? " Have them link World ID first, so no minute is lost." : ""}
                </>
                : lasts ? `At the full rate, this lasts ${plural(lasts)}. It runs until the total is used or you close it. Unused allowance doesn't roll over.` : null}</p>
            </> : <>
              <div className="grid gap-4 sm:grid-cols-2">
                <AmountField id="daily" label="Daily cap" value={daily} onChange={setDaily} symbol={symbol} />
                <AmountField id="per" label="Max per payment" value={perPayment} onChange={setPerPayment} symbol={symbol} />
              </div>
              <div>
                <label htmlFor="ends" className="font-semibold">Mandate ends</label>
                <input id="ends" type="date" className="field mt-2" value={ends} min={dayInput(new Date(openedAt + 86_400_000))}
                  max={agent ? dayInput(new Date(Number(agent.expiry) * 1000 - 86_400_000)) : undefined} onChange={(event) => setEnds(event.target.value)} />
              </div>
            </>}
            {budgetError && total ? <p role="alert" className="rounded-2xl bg-bad-soft px-4 py-3 text-sm font-medium text-bad">{budgetError}</p> : null}
            <div className="flex justify-between"><Button variant="ghost" onClick={() => setStep("who")}>Back</Button><Button size="lg" disabled={!!budgetError} onClick={() => setStep("review")}>Review</Button></div>
          </div>

          : step === "review" && totalParsed.ok ? <Signer address={address} draft={draft} kind={kind} person={person} agent={agent} units={units}
            total={totalParsed.value} terms={kind === "agent" ? { period: 0 } : terms} cap={capParsed.ok ? capParsed.value : totalParsed.value}
            daily={dailyParsed.ok ? dailyParsed.value : BigInt(0)} perPayment={perParsed.ok ? perParsed.value : BigInt(0)} expiry={endsAt}
            sentence={sentence} palette={palette} onBack={() => setStep("budget")}
            onEnsChanged={() => { setStep("who"); setPerson(null); setConfirmed(false); setWhoError("The ENS name now points somewhere else. Look it up again and confirm the new wallet."); }}
            onSession={checkSession}
            onDone={(next) => { setResult(next); setStep("done"); }} />

          : step === "done" && result ? <Done address={address} kind={kind} who={who} result={result} sentence={sentence} />
          : null}
        </motion.div>
      </AnimatePresence>
    </div>
  </section>;
}

function Signer({ address, draft, kind, person, agent, units, total, terms, cap, daily, perPayment, expiry, sentence, palette, onBack, onEnsChanged, onSession, onDone }: {
  address: string; draft: Draft; kind: Kind; person: Person | null; agent: EnsName | null; units: (value: bigint) => string;
  total: bigint; terms: Terms; cap: bigint; daily: bigint; perPayment: bigint; expiry: number; sentence: string;
  palette: ReturnType<typeof allocationPalette>; onBack: () => void; onEnsChanged: () => void; onSession: (error: unknown) => void;
  onDone: (result: { id: string; mandate: boolean }) => void;
}) {
  const { client, config } = useAccord();
  const { requireWallet, waitForSuccess, sendPermitTransaction } = useChainActions(address);
  const sponsor = useSponsoredTransaction();
  const initial = useMemo(() => [
    { id: "approve", label: `Let Accord move ${units(total)}` },
    { id: "fund", label: kind === "person" ? "Fund the allowance" : "Fund the budget" },
    ...(kind === "agent" ? [{ id: "mandate", label: "Grant the agent its mandate" }] : []),
  ], [kind, total, units]);
  const tracker = useSteps(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fundedId, setFundedId] = useState<string | null>(null);
  const prompts = kind === "agent" ? 3 : 2;

  async function grantMandate(allocationId: string) {
    const registry = config.data?.ensRegistryAddress;
    if (!registry || !agent) throw new Error("The trusted ENS registry isn't configured.");
    await tracker.run("mandate", "Confirm in your wallet", async () => {
      const envelope = await client!.setMandate({
        draftId: draft.id, requestKey: crypto.randomUUID(), allocationId, agent: getAddress(agent.owner), registry: getAddress(registry),
        nameId: agent.nameId, expectedResource: agent.resource, dailyCap: daily.toString(), maxPerPayment: perPayment.toString(), expiry: String(expiry),
        agentEnsName: agent.name,
      });
      return sendPermitTransaction(envelope.permit.requestId as Hex, () => sponsor.send(getAddress(envelope.spaceAddress), envelope.calldata as Hex));
    });
  }

  async function run() {
    if (busy || !client) return;
    setBusy(true); setError(null);
    let funded: string | null = fundedId;
    try {
      requireWallet();
      if (!funded) {
        const envelope = await tracker.run("approve", "Preparing", async () => {
          const next = await client.createAllocation({
            draftId: draft.id, requestKey: crypto.randomUUID(),
            beneficiary: kind === "agent" ? zeroAddress : person!.address,
            ...(kind === "person" && person?.ensName ? { beneficiaryEnsName: person.ensName } : {}),
            amount: total.toString(), periodCap: (terms.period === 0 ? total : cap).toString(), period: terms.period,
            ...(terms.schedule ? { schedule: terms.schedule } : {}),
          });
          tracker.update("approve", { detail: "Confirm in your wallet" });
          const hash = await sponsor.send(getAddress(next.tokenAddress), encodeFunctionData({ abi: erc20ApproveAbi,
            functionName: "approve", args: [getAddress(next.spaceAddress), BigInt(next.approvalAmount)] }), BigInt(150_000));
          tracker.update("approve", { detail: "Confirming on Sepolia" });
          await waitForSuccess(hash);
          tracker.update("approve", { hash });
          return next;
        });
        await tracker.run("fund", "Confirm in your wallet", () => sendPermitTransaction(envelope.permit.requestId as Hex,
          () => sponsor.send(getAddress(envelope.spaceAddress), envelope.calldata as Hex)));
        funded = envelope.permit.allocationId.toString();
        setFundedId(funded);
      }
      if (kind === "agent") await grantMandate(funded);
      void confetti({ particleCount: 90, spread: 70, origin: { y: 0.4 }, colors: ["#FF8A4C", "#A98BFF", "#C4F26A", "#FF90C9", "#7CC7FF"], disableForReducedMotion: true });
      onDone({ id: funded, mandate: true });
    } catch (cause) {
      onSession(cause);
      if (tagOf(cause) === "Conflict") { onEnsChanged(); return; }
      setError(funded ? `The budget is funded, but the mandate didn't go through. ${describeError(cause, "")}`.trim() : describeError(cause, "Funding didn't finish."));
    } finally { setBusy(false); }
  }

  return <div>
    <div className="rounded-3xl p-5" style={{ background: palette.soft }}>
      <p className="font-display text-2xl font-extrabold leading-snug">{sentence}</p>
      <ul className="mt-4 grid gap-2 text-sm text-ink-soft">
        {kind === "agent" ? <>
          <li className="flex items-center gap-2"><ScanLine size={16} />Every recipient is screened by Intercepta first</li>
          <li className="flex items-center gap-2"><AtSign size={16} />Stops if {agent?.name} changes owner</li>
          <li className="flex items-center gap-2"><Lock size={16} />The agent can’t raise its own limits</li>
        </> : <li className="flex items-center gap-2"><Lock size={16} />Only {person ? shortAddress(person.address) : "their wallet"} can claim</li>}
        <li className="flex items-center gap-2"><Ban size={16} />You can close it and take back what’s unspent at any time</li>
      </ul>
    </div>
    <div className="mt-5"><TxTracker steps={tracker.steps} /></div>
    {error ? <p role="alert" className="mt-4 rounded-2xl bg-bad-soft px-4 py-3 text-sm font-medium text-bad">{error}</p> : null}
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <Button variant="ghost" disabled={busy || !!fundedId} onClick={onBack}>Back</Button>
      <div className="flex flex-wrap gap-2">
        {fundedId && error ? <Button variant="soft" disabled={busy} onClick={() => onDone({ id: fundedId, mandate: false })}>Finish later</Button> : null}
        <Button size="lg" loading={busy} onClick={() => void run()}>{fundedId ? "Grant mandate" : `Fund ${units(total)}`}</Button>
      </div>
    </div>
    <p className="mt-3 text-right text-sm text-muted">{fundedId ? "1 wallet prompt" : `${prompts} wallet prompts`}</p>
  </div>;
}

function Done({ address, kind, who, result, sentence }: { address: string; kind: Kind; who: string; result: { id: string; mandate: boolean }; sentence: string }) {
  const path = `/spaces/${address}/a/${result.id}`;
  useEffect(() => { document.getElementById("allocate-title")?.focus(); }, []);
  return <div className="grid gap-6">
    {result.mandate ? <p className="text-lg text-ink-soft">{sentence}</p>
      : <p className="rounded-2xl bg-warn-soft px-4 py-3 font-medium text-warn">The budget is funded, but the agent can’t pay until you grant its mandate. You can do that from its page.</p>}
    <div>
      <h2 className="font-display text-2xl font-extrabold">{kind === "person" ? `${who} can find this allowance` : "Share it with whoever runs the agent"}</h2>
      <p className="mb-4 mt-1 text-muted">{kind === "person" ? "It appears under Shared with you when they sign in with this wallet. You can send the direct link too." : "The agent uses this allocation to request payments."}</p>
      <SharePanel path={path} />
    </div>
    <div className="flex flex-wrap justify-end gap-2">
      <Button asChild variant="light"><Link href={`/spaces/${address}`}>Back to Space</Link></Button>
      <Button asChild><Link href={path}>Open {kind === "person" ? "allowance" : "budget"}</Link></Button>
    </div>
  </div>;
}
