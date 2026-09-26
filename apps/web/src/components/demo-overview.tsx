"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUpRight, AtSign, Check, CheckCheck, ChevronRight, CircleSlash, Clock3, Code2, FileText, Fingerprint, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import type { AccordClient } from "@accord/sdk";
import { useAccord } from "@/lib/accord";
import { amount, shortAddress } from "@/lib/format";
import { allocationPalette } from "@/lib/palette";
import { Avatar } from "./avatar";
import { Button } from "./ui/button";

type Evidence = Awaited<ReturnType<AccordClient["demoEvidence"]>>;
type Run = Evidence["cases"][number];
const notes = "https://github.com/hrsh22/ethtokyo26/blob/main/docs/agent-toolkit-live-evidence.md";
const explorer = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;
const date = (value: string) => new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const stories = {
  approved: { title: "A purchase approved", body: "The owner verified with World and approved a 20 tUSDC research purchase.", icon: Fingerprint, color: "bg-good-soft text-good", label: "Human approval" },
  denied: { title: "A decision respected", body: "The owner declined another purchase. The agent's budget stayed untouched.", icon: CircleSlash, color: "bg-tang-soft text-[#ac5127]", label: "Owner control" },
  revoked: { title: "Authority switched off", body: "Revoking the ENS name stopped a payment that was already approved.", icon: AtSign, color: "bg-lilac-soft text-[#6544ba]", label: "ENSv2 revocation" },
} as const;
const flow = [
  { title: "Quote", tool: "accord_quote", body: "The assistant asks for an exact research price. Nothing is spent." },
  { title: "Pause", tool: "accord_purchase", body: "Above the owner’s approval threshold, Accord returns a review link instead of paying." },
  { title: "Decide", tool: "World ID", body: "The owner verifies with World, then approves or denies the exact amount and recipient." },
  { title: "Resume", tool: "accord_resume", body: "The assistant continues the same quote. The Space checks ENS authority and limits again." },
];
function status(run: Run) {
  if (run.checks.some(c => c.status === "failed")) return { text: "Needs review", color: "text-bad", Icon: TriangleAlert };
  if (!run.checks.length || run.checks.some(c => c.status === "unavailable")) return { text: "Check unavailable", color: "text-muted", Icon: Clock3 };
  return { text: "Evidence checked", color: "text-good", Icon: CheckCheck };
}
function External({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1.5 font-semibold hover:underline ${className}`}>{children}<ArrowUpRight size={15} className="shrink-0"/></a>;
}

export function DemoOverview() {
  const { client } = useAccord();
  const [selected, setSelected] = useState<Run["id"]>("approved");
  const evidence = useQuery({ queryKey: ["public-demo-evidence"], queryFn: () => client!.demoEvidence(), enabled: !!client,
    staleTime: 45_000, refetchInterval: 60_000, refetchOnWindowFocus: false, retry: false });
  const data = evidence.data, run = data?.cases.find(item => item.id === selected);
  function inspectRun(id: Run["id"]) {
    setSelected(id);
    requestAnimationFrame(() => {
      const panel = document.getElementById("demo-run");
      panel?.focus({ preventScroll: true });
      panel?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  }
  return <div className="pb-4">
    <header className="max-w-[780px]">
      <span className="pill bg-white"><span className="size-2 rounded-full bg-lilac"/>Recorded demo · Sepolia</span>
      <h1 className="mt-4 font-display text-5xl font-extrabold tracking-tight sm:text-6xl">See Accord in action.</h1>
      <p className="mt-4 max-w-[680px] text-lg text-ink-soft">A named agent buys research, asks for permission, and stops when its owner says so. Explore the real requests and receipts.</p>
    </header>

    {evidence.isError ? <div role="alert" className="card mt-7 flex flex-wrap items-center gap-4 p-6"><TriangleAlert className="shrink-0 text-warn"/>
      <p className="min-w-0 flex-1 text-ink-soft">{data ? "We couldn't refresh the evidence. Showing the last check below." : "We couldn't load the demo evidence. Try again in a moment."}</p>
      <Button variant="soft" loading={evidence.isFetching} onClick={() => void evidence.refetch()}>Try again</Button></div> : null}
    {!data && evidence.isPending ? <div role="status" className="mt-8 space-y-5"><p className="flex items-center gap-2 text-muted"><RefreshCw size={16} className="animate-spin"/>Checking the recorded requests and Sepolia receipts…</p>
      <div className="h-28 animate-pulse rounded-tile bg-white/70"/><div className="grid gap-4 md:grid-cols-3">{[1,2,3].map(i => <div key={i} className="h-56 animate-pulse rounded-tile bg-white/70"/>)}</div></div> : null}

    {data ? <>
      <section aria-label="Demo agent and current state" className="card mt-8 flex flex-wrap items-center gap-5 p-6 sm:p-7">
        <Avatar kind="agent" palette={allocationPalette(BigInt(2), true)} size={58}/>
        <div className="min-w-0 flex-1 basis-[220px]">
          <p className="text-sm text-muted">{data.spaceName} · research agent</p>
          <Link href={`/spaces/${data.spaceAddress}/a/${data.allocationId}`} className="mt-1 block break-all font-semibold text-[#6544ba] hover:underline">{data.agentName}</Link>
          <p className="mt-2 text-sm text-muted">This agent was intentionally revoked at the end of the demo.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className={`pill ${data.identity.status === "inactive" ? "bg-lilac-soft text-[#6544ba]" : data.identity.status === "active" ? "bg-good-soft text-good" : "bg-soft text-muted"}`}>
            <AtSign size={14}/>{data.identity.status === "inactive" ? "Inactive now" : data.identity.status === "active" ? "Active now" : "Current status unavailable"}
          </span>
          {data.identity.remaining !== null ? <span className="font-semibold">{amount(BigInt(data.identity.remaining), 6)} tUSDC left</span> : null}
        </div>
      </section>

      <section aria-labelledby="demo-flow" className="mt-8">
        <h2 id="demo-flow" className="font-display text-2xl font-extrabold sm:text-3xl">How each run works</h2>
        <p className="mt-2 text-ink-soft">An external assistant used Accord’s MCP tools. Accord and the Space contract decided what it could spend.</p>
        <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{flow.map((step, index) => <li key={step.title} className="card p-5">
          <span className="text-sm font-semibold text-muted">0{index + 1}</span>
          <h3 className="mt-1 font-display text-xl font-extrabold">{step.title}</h3>
          <code className="mt-2 inline-block rounded-lg bg-lilac-soft px-2 py-1 text-xs font-semibold text-[#6544ba]">{step.tool}</code>
          <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
        </li>)}</ol>
      </section>

      <div className="mb-4 mt-10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-extrabold sm:text-3xl">Three outcomes. Real evidence.</h2>
        <Button size="sm" variant="ghost" loading={evidence.isFetching} onClick={() => void evidence.refetch()} title="Checks refresh about once a minute.">{!evidence.isFetching ? <RefreshCw/> : null}Refresh checks</Button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {data.cases.map((item, index) => {
          const story = stories[item.id], state = status(item), Icon = story.icon;
          return <article key={item.id} className={`card flex min-w-0 flex-col p-6 ring-2 transition-shadow ${selected === item.id ? "ring-lilac" : "ring-transparent"}`}>
            <div className="flex items-center justify-between gap-2"><span className={`grid size-11 place-items-center rounded-2xl ${story.color}`}><Icon size={22}/></span><span className="text-sm font-semibold text-muted">0{index + 1}</span></div>
            <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-muted">{story.label}</p>
            <h3 className="mt-1 font-display text-2xl font-extrabold">{story.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-soft">{story.body}</p>
            <div className={`mt-4 flex items-center gap-1.5 text-xs font-semibold ${state.color}`}><state.Icon size={15}/>{state.text}</div>
            <button type="button" aria-pressed={selected === item.id} aria-controls="demo-run" onClick={() => inspectRun(item.id)} className="mt-4 flex items-center justify-between rounded-2xl bg-soft px-4 py-3 text-sm font-semibold transition-colors hover:bg-lilac-soft">{selected === item.id ? "Viewing evidence" : "Inspect this run"}<ChevronRight size={17}/></button>
          </article>;
        })}
      </div>

      {run ? <section id="demo-run" tabIndex={-1} aria-label={stories[run.id].title} className="card mt-6 scroll-mt-24 overflow-hidden outline-none">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 sm:px-8">
          <div><p className="text-sm text-muted">Recorded purchase{run.createdAt ? ` · ${date(run.createdAt)}` : ""}</p><h2 className="mt-1 font-display text-2xl font-extrabold">{stories[run.id].title}</h2></div>
          <span className="pill bg-soft"><FileText size={15}/>{amount(BigInt(run.amount), 6)} tUSDC requested</span>
        </div>
        <div className="grid grid-cols-1 gap-8 p-6 sm:p-8 lg:grid-cols-2">
          <div className="min-w-0">
            <h3 className="mb-3 font-semibold">Evidence checks</h3>
            <ul className="space-y-3">{run.checks.map(c => <li key={c.label} className="flex items-start gap-3">
              <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${c.status === "passed" ? "bg-good-soft text-good" : c.status === "failed" ? "bg-bad-soft text-bad" : "bg-soft text-muted"}`}>{c.status === "passed" ? <Check size={14}/> : c.status === "failed" ? <TriangleAlert size={13}/> : <Clock3 size={13}/>}</span>
              <details className="min-w-0 flex-1"><summary className="cursor-pointer text-sm font-semibold">{c.label}<span className="ml-2 text-xs font-normal text-muted">{c.source}</span></summary><p className="mt-2 text-sm leading-relaxed text-muted">{c.detail}</p></details>
            </li>)}</ul>
            <details className="mt-6 border-t border-line pt-4 text-sm"><summary className="cursor-pointer font-semibold text-muted">Request details</summary>
              {run.repositories.length ? <div className="mt-3"><h4 className="font-semibold">Repository comparison</h4><p className="mt-2 break-words text-sm leading-relaxed text-ink-soft">{run.repositories.join(" · ")}</p><p className="mt-1 text-sm text-muted">Criteria: {run.criteria.join(", ")}</p></div> : null}
              <dl className="mt-3 space-y-2 text-xs"><div><dt className="text-muted">Quote</dt><dd className="break-all font-mono">{run.quoteId}</dd></div>{run.recipient ? <div><dt className="text-muted">Recipient</dt><dd className="break-all font-mono">{run.recipient}</dd></div> : null}<div><dt className="text-muted">Space contract</dt><dd><External href={`https://sepolia.etherscan.io/address/${data.spaceAddress}`}>{shortAddress(data.spaceAddress)}</External></dd></div></dl>
            </details>
            {run.id === "revoked" && run.transactionHash ? <External href={explorer(run.transactionHash)} className="mt-5 text-sm text-[#6544ba]">ENS revocation receipt</External> : null}
          </div>
          <Result run={run}/>
        </div>
      </section> : null}
      <p className="mt-4 text-xs leading-relaxed text-muted">Last checked {date(data.checkedAt)}{data.blockNumber ? ` · Sepolia block ${data.blockNumber}` : " · Chain check unavailable"}. World uses the event sandbox. Owner decisions are Accord records; receipts and request consumption are checked onchain.</p>
    </> : null}

    <section className="mt-10 flex flex-wrap items-center gap-6 rounded-tile bg-lilac-soft p-7 sm:p-9">
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/70 text-[#6544ba]"><Code2 size={24}/></span>
      <div className="min-w-0 flex-1 basis-[280px]"><h2 className="font-display text-2xl font-extrabold">Give your own agent a budget.</h2><p className="mt-2 text-ink-soft">Connect through the SDK or MCP and try the same controls in your Space.</p></div>
      <div className="flex flex-wrap gap-3"><Button asChild><Link href="/developers">Connect your agent<ArrowUpRight/></Link></Button>{data ? <Button asChild variant="onColor"><Link href={`/spaces/${data.spaceAddress}`}>Explore the Space</Link></Button> : null}</div>
    </section>
    <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted"><External href={notes}>Full test notes</External><External href="/api/v1/demo/evidence">Evidence JSON</External><External href="https://github.com/hrsh22/ethtokyo26">Source code</External></div>
  </div>;
}

function Result({ run }: { run: Run }) {
  if (run.id === "approved") {
    const payment = run.checks.find(c => c.label === "Exact payment confirmed" && c.source === "Sepolia");
    const checked = payment?.status === "passed", failed = payment?.status === "failed";
    const Icon = checked ? CheckCheck : failed ? TriangleAlert : Clock3;
    return <div className={`flex min-w-0 flex-col justify-center rounded-3xl p-6 sm:p-8 ${checked ? "bg-good-soft" : "bg-soft"}`}>
      <Icon size={32} className={checked ? "text-good" : failed ? "text-bad" : "text-muted"}/>
      <h3 className="mt-4 font-display text-3xl font-extrabold">{checked ? "The payment settled." : failed ? "Payment needs review." : "Inspect the payment receipt."}</h3>
      <p className="mt-3 text-ink-soft">{checked ? "The Space payment and tUSDC transfer match this exact request." : "The recorded receipt is available for inspection. The current checks have not confirmed this payment."}</p>
      <div className="mt-6 rounded-2xl bg-white/70 p-4">
        <b className="font-display text-2xl">{checked ? `${amount(BigInt(run.amount), 6)} tUSDC paid` : failed ? "Payment check failed" : "Payment check unavailable"}</b>
        <p className="mt-1 text-sm text-muted">{checked ? payment.detail : "Review the evidence checks for the current result."}</p>
      </div>
      {run.transactionHash ? <div className="mt-5">
        <External href={explorer(run.transactionHash)} className="text-sm text-[#6544ba]">View payment receipt on Sepolia</External>
        <p className="mt-2 break-all font-mono text-xs text-muted">{run.transactionHash}</p>
      </div> : null}
    </div>;
  }
  if (run.id === "denied") {
    const checked = run.checks.some(c => c.label === "Payment request remains unused" && c.status === "passed");
    return <div className="flex min-h-[260px] flex-col justify-center rounded-3xl bg-tang-soft p-6 sm:p-8"><CircleSlash size={32} className="text-[#ac5127]"/><h3 className="mt-4 font-display text-3xl font-extrabold">{checked ? "The payment stayed blocked." : "Inspect the denied request."}</h3>
      <p className="mt-3 text-ink-soft">A valid name and available budget do not override the owner’s decision.</p><div className="mt-6 rounded-2xl bg-white/70 p-4"><b className="font-display text-2xl">{checked ? "0 tUSDC paid" : "Payment check unavailable"}</b><p className="mt-1 text-sm text-muted">{checked ? "No submitted payment is recorded, and the contract has not consumed this request." : "Check the evidence on the left for the current result."}</p></div></div>;
  }
  const replay = run.checks.find(c => c.source === "Historical simulation");
  return <div className="rounded-3xl bg-lilac-soft p-6 sm:p-8"><AtSign size={32} className="text-[#6544ba]"/><h3 className="mt-4 font-display text-3xl font-extrabold">Approval has limits.</h3><p className="mt-3 text-ink-soft">The same signed payment is replayed against the blocks immediately before and after ENS revocation.</p>
    {replay?.status === "passed" ? <div className="mt-5 space-y-2"><div className="rounded-2xl bg-white/75 p-4"><p className="text-xs text-muted">Before revocation</p><b className="mt-1 flex items-center gap-2 text-good"><Check size={17}/>Simulation passes</b></div><ArrowDown size={18} className="mx-auto text-[#6544ba]"/><div className="rounded-2xl bg-white/75 p-4"><p className="text-xs text-muted">After revocation · permit still valid</p><b className="mt-1 flex items-center gap-2 text-[#6544ba]"><ShieldCheck size={17}/>Blocked by ENS authority</b></div></div>
    : <p className="mt-5 rounded-2xl bg-white/70 p-4 text-sm text-muted">{replay?.status === "failed" ? "The replay did not match the recorded result." : "The historical replay is unavailable right now. The revocation receipt can still be inspected."}</p>}
    <p className="mt-4 text-xs leading-relaxed text-muted">Historical simulation, rechecked against Sepolia. It broadcasts no payment. {run.checks.some(c => c.label === "ENS revocation confirmed" && c.status === "passed") ? "The revocation itself is a confirmed transaction." : "Use the receipt link to inspect the recorded revocation transaction."}</p>
  </div>;
}
