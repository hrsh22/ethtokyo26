"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowUpRight, Hammer, Plus, RotateCw, UserRound } from "lucide-react";
import { useEffect } from "react";
import { zeroAddress } from "viem";
import type { AccordClient } from "@accord/sdk";
import { useAccord } from "@/lib/accord";
import { amount, shortAddress } from "@/lib/format";
import { allocationPalette, keyPalette } from "@/lib/palette";
import { allocationStatus, statusLabel, summarize } from "@/lib/space-summary";
import { useAllocation } from "@/lib/use-allocation";
import { useSpaceMeta } from "@/lib/use-space";
import { useSpaceTerms } from "@/lib/use-space-terms";
import { Avatar } from "../avatar";
import { DemoTokenFaucet } from "../demo-token-faucet";
import { SignInCard } from "../sign-in-card";
import { WorldIdCard } from "../world-id-card";
import { Button } from "../ui/button";

type Draft = Awaited<ReturnType<AccordClient["listSpaces"]>>["spaces"][number];
type Received = Awaited<ReturnType<AccordClient["listReceivedAllowances"]>>["allowances"][number];
export function SpacesHome() {
  const { client, config, auth, account, checkSession } = useAccord();
  const demoAddress = config.data?.demoSpaceAddress;
  const spaces = useQuery({ queryKey: ["spaces", account?.toLowerCase()], queryFn: () => client!.listSpaces(), enabled: !!client && auth.signedIn, retry: false });
  const received = useQuery({ queryKey: ["received-allowances", account?.toLowerCase()], queryFn: () => client!.listReceivedAllowances(),
    enabled: !!client && auth.signedIn, retry: false, refetchInterval: 30_000 });
  useEffect(() => { if (spaces.error) checkSession(spaces.error); }, [spaces.error, checkSession]);
  useEffect(() => { if (received.error) checkSession(received.error); }, [received.error, checkSession]);
  const list = (spaces.data?.spaces ?? []).toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return <div>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-5xl font-extrabold tracking-[-0.03em] sm:text-6xl">Your Spaces</h1>
        <p className="mt-2 text-lg text-ink-soft">Manage your Spaces and see what others have shared with you.</p>
      </div>
      {auth.signedIn ? <Button asChild size="lg"><Link href="/spaces/new"><Plus />New Space</Link></Button> : null}
    </header>

    {!auth.signedIn ? <div className={`mt-8 grid gap-4 ${demoAddress ? "lg:grid-cols-[1.4fr_1fr]" : ""}`}>
      <SignInCard title="Sign in to see your Spaces" body="Connect a wallet, then sign one message to see the Spaces you own and allowances shared with you. No transaction, no fee." />
      {demoAddress ? <Link href={`/spaces/${demoAddress}`} className="card group flex items-center gap-4 p-6 transition-transform hover:-translate-y-0.5">
        <Avatar kind="agent" palette={allocationPalette(BigInt(1), true)} size={52} />
        <span className="flex-1"><b className="block font-display text-xl font-extrabold">Explore the live demo</b><span className="text-sm text-muted">A public Space with a person and an agent. No wallet needed.</span></span>
        <ArrowUpRight className="text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </Link> : null}
    </div> : <>
    {spaces.isPending ? <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-[260px] animate-pulse rounded-tile bg-white/70" />)}</div>
    : spaces.isError ? <div role="alert" className="card mt-8 flex flex-wrap items-center gap-4 p-7">
      <span className="flex-1"><b className="block font-display text-2xl font-extrabold">We couldn’t load your Spaces</b><span className="text-muted">Your Spaces are safe. Check your connection and try again.</span></span>
      <Button variant="soft" onClick={() => void spaces.refetch()}><RotateCw />Try again</Button>
    </div>
    : list.length === 0 ? <EmptyHome />
    : <>
      <motion.ul initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.06 } } }} className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {list.map((space) => <motion.li key={space.id} variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}>
          {space.spaceAddress ? <SpaceCard draft={space} address={space.spaceAddress} /> : <DraftCard draft={space} />}
        </motion.li>)}
        <motion.li variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}>
          <Link href="/spaces/new" className="grid h-full min-h-[260px] place-content-center justify-items-center gap-3 rounded-tile border-[2.5px] border-dashed border-[#c9c4dd] text-center font-semibold text-muted transition-colors hover:border-ink/40 hover:text-ink">
            <span className="grid size-12 place-items-center rounded-full bg-white text-ink shadow-float"><Plus /></span>New Space
          </Link>
        </motion.li>
      </motion.ul>
      <div className="mt-8 grid gap-4 lg:grid-cols-2"><DemoTokenFaucet /><WorldIdCard /></div>
    </>}
    <section className="mt-12" aria-labelledby="received-title">
      <h2 id="received-title" className="font-display text-3xl font-extrabold">Shared with you</h2>
      {received.isPending ? <div className="card mt-4 p-6 text-muted">Looking for allowances…</div>
      : received.isError ? <div role="alert" className="card mt-4 flex flex-wrap items-center gap-4 p-6">
        <span className="flex-1"><b className="block font-display text-xl font-extrabold">We couldn’t load your allowances</b>
          <span className="text-sm text-muted">Check your connection and try again.</span></span>
        <Button variant="soft" onClick={() => void received.refetch()}><RotateCw />Try again</Button>
      </div>
      : received.data?.allowances.length ? <ul className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {received.data.allowances.map((entry) => <li key={`${entry.spaceAddress}:${entry.allocationId}`}>
          <ReceivedCard entry={entry} account={account!} />
        </li>)}
      </ul>
      : <div className="card relative mt-4 flex max-w-3xl items-center gap-5 overflow-hidden p-6 sm:p-8">
        <div className="blob -right-12 -top-20 size-56 bg-tang/30" />
        <div className="relative shrink-0"><Avatar kind="person" palette={allocationPalette(BigInt(1), false)} size={60} /></div>
        <div className="relative">
          <h3 className="font-display text-2xl font-extrabold">Nothing shared yet</h3>
          <p className="mt-1 text-ink-soft">When someone gives you an allowance, you’ll find it here.</p>
        </div>
      </div>}
    </section>
    </>}
  </div>;
}

function ReceivedCard({ entry, account }: { entry: Received; account: string }) {
  const allocation = useAllocation(entry.spaceAddress, BigInt(entry.allocationId));
  const meta = useSpaceMeta(entry.spaceAddress);
  const data = allocation.data;
  if (data && data.allocation[0].toLowerCase() !== account.toLowerCase()) return null;
  const status = data ? allocationStatus(data, data.blockTimestamp) : null;
  const palette = allocationPalette(BigInt(entry.allocationId), false);
  return <Link href={`/spaces/${entry.spaceAddress}/a/${entry.allocationId}`}
    className="group flex h-full min-h-[190px] flex-col rounded-tile p-6 shadow-float transition-transform hover:-translate-y-1"
    style={{ background: palette.tile, color: palette.ink }}>
    <div className="flex items-start justify-between gap-3">
      <span className="flex items-center gap-2"><UserRound size={18} />Allowance #{entry.allocationId}</span>
      <ArrowUpRight className="opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </div>
    <h3 className="mt-5 font-display text-2xl font-extrabold leading-tight">{entry.spaceName || `Space ${shortAddress(entry.spaceAddress)}`}</h3>
    <p className="mt-auto pt-4 font-semibold">{data && meta.data ? `${amount(data.allocation[1], meta.data.decimals)} ${meta.data.symbol} left`
      : allocation.isError || meta.isError ? "Open to view current terms" : "Reading Sepolia…"}</p>
    {status ? <span className="mt-2 text-sm opacity-75">{statusLabel[status]}</span> : null}
  </Link>;
}

function SpaceCard({ draft, address }: { draft: Draft; address: string }) {
  const terms = useSpaceTerms(address);
  const meta = useSpaceMeta(address);
  const palette = keyPalette(address);
  const summary = terms.data ? summarize(terms.data.allocations) : null;
  const shown = terms.data?.allocations.filter(({ allocation }) => !allocation[6]).slice(-4) ?? [];
  return <Link href={`/spaces/${address}`} className="group relative flex min-h-[260px] flex-col overflow-hidden rounded-tile p-6 shadow-float transition-transform hover:-translate-y-1"
    style={{ background: palette.tile, color: palette.ink }}>
    <div className="flex items-start justify-between gap-3">
      <span className="pill">Active</span>
      <ArrowUpRight className="opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </div>
    <h2 className="mt-4 font-display text-3xl font-extrabold leading-tight tracking-tight">{draft.name}</h2>
    <div className="mt-auto pt-6">
      <div className="flex -space-x-2">{shown.map((entry) => <Avatar key={entry.id.toString()} kind={entry.allocation[0] === zeroAddress ? "agent" : "person"}
        palette={allocationPalette(entry.id, entry.allocation[0] === zeroAddress)} size={34} className="ring-2 ring-white/70" />)}</div>
      <p className="mt-3 font-display text-[32px] font-extrabold leading-none">
        {summary && meta.data ? amount(summary.reserved, meta.data.decimals) : "—"} <span className="text-lg opacity-70">{meta.data?.symbol ?? ""} reserved</span>
      </p>
      <p className="mt-1 text-sm opacity-75">{summary ? summary.open === 0 ? "No allocations yet" : `${summary.people} ${summary.people === 1 ? "person" : "people"}, ${summary.agents} ${summary.agents === 1 ? "agent" : "agents"}` : "Reading Sepolia…"}</p>
    </div>
  </Link>;
}

function DraftCard({ draft }: { draft: Draft }) {
  return <Link href={`/spaces/new?draft=${draft.id}`} className="card group flex h-full min-h-[260px] flex-col p-6 transition-transform hover:-translate-y-1">
    <span className="pill w-fit bg-warn-soft text-warn"><Hammer size={14} />Setup unfinished</span>
    <h2 className="mt-4 font-display text-3xl font-extrabold leading-tight tracking-tight">{draft.name}</h2>
    <p className="mt-2 text-muted">Deploy it on Sepolia to start adding people and agents.</p>
    <span className="mt-auto pt-6 font-semibold">Finish setup <ArrowUpRight className="inline size-4" /></span>
  </Link>;
}

function EmptyHome() {
  const warm = allocationPalette(BigInt(1), false);
  const cool = allocationPalette(BigInt(1), true);
  return <div className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
    <section className="card relative overflow-hidden p-8 sm:p-10">
      <div className="blob -right-10 -top-16 size-64 bg-tang/40" />
      <div className="relative">
        <div className="flex gap-2"><Avatar kind="person" palette={warm} size={56} /><Avatar kind="agent" palette={cool} size={56} /></div>
        <h2 className="mt-6 font-display text-4xl font-extrabold leading-none tracking-tight">Create your first Space</h2>
        <p className="mt-3 max-w-md text-ink-soft">Name it, deploy it in one transaction, then give a person an allowance or an agent a budget.</p>
        <Button asChild size="lg" className="mt-6"><Link href="/spaces/new"><Plus />New Space</Link></Button>
      </div>
    </section>
    <div className="grid content-start gap-4"><DemoTokenFaucet /><WorldIdCard /></div>
  </div>;
}
