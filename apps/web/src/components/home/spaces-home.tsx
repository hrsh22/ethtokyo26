"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowUpRight, Hammer, Link2, Plus, RotateCw } from "lucide-react";
import { useEffect } from "react";
import { zeroAddress } from "viem";
import type { AccordClient } from "@accord/sdk";
import { useAccord } from "@/lib/accord";
import { amount } from "@/lib/format";
import { allocationPalette, keyPalette } from "@/lib/palette";
import { summarize } from "@/lib/space-summary";
import { useSpaceMeta } from "@/lib/use-space";
import { useSpaceTerms } from "@/lib/use-space-terms";
import { Avatar } from "../avatar";
import { OpenLinkForm } from "../open-link";
import { SignInCard } from "../sign-in-card";
import { WorldIdCard } from "../world-id-card";
import { Button } from "../ui/button";

type Draft = Awaited<ReturnType<AccordClient["listSpaces"]>>["spaces"][number];
const demoAddress = process.env.NEXT_PUBLIC_DEMO_SPACE_ADDRESS;

export function SpacesHome() {
  const { client, auth, account, checkSession } = useAccord();
  const spaces = useQuery({ queryKey: ["spaces", account?.toLowerCase()], queryFn: () => client!.listSpaces(), enabled: !!client && auth.signedIn, retry: false });
  useEffect(() => { if (spaces.error) checkSession(spaces.error); }, [spaces.error, checkSession]);
  const list = (spaces.data?.spaces ?? []).toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return <div>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-5xl font-extrabold tracking-[-0.03em] sm:text-6xl">Your Spaces</h1>
        <p className="mt-2 text-lg text-ink-soft">Each Space holds funds and the rules for who can use them.</p>
      </div>
      {auth.signedIn ? <Button asChild size="lg"><Link href="/spaces/new"><Plus />New Space</Link></Button> : null}
    </header>

    {!auth.signedIn ? <div className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <SignInCard title="Sign in to see your Spaces" body="Connect a wallet, then sign one message to see the Spaces you own. No transaction, no fee." />
      <div className="grid gap-4">
        <LinkCard />
        {demoAddress ? <Link href={`/spaces/${demoAddress}`} className="card group flex items-center gap-4 p-6 transition-transform hover:-translate-y-0.5">
          <Avatar kind="agent" palette={allocationPalette(BigInt(1), true)} size={52} />
          <span className="flex-1"><b className="block font-display text-xl font-extrabold">Explore the live demo</b><span className="text-sm text-muted">A public Space with a person and an agent. No wallet needed.</span></span>
          <ArrowUpRight className="text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link> : null}
      </div>
    </div> : spaces.isPending ? <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-[260px] animate-pulse rounded-tile bg-white/70" />)}</div>
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
      <div className="mt-10 grid gap-4 lg:grid-cols-2"><LinkCard /><WorldIdCard /></div>
    </>}
  </div>;
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
    <div className="grid content-start gap-4"><LinkCard /><WorldIdCard /></div>
  </div>;
}

function LinkCard() {
  return <section className="card p-6" aria-labelledby="link-card-title">
    <span className="mb-4 grid size-11 place-items-center rounded-2xl bg-sky-soft text-[#2B7CC4]"><Link2 size={20} /></span>
    <h2 id="link-card-title" className="font-display text-2xl font-extrabold">Got a link?</h2>
    <p className="mb-4 mt-1 text-sm text-muted">Someone shared an allowance or a budget with you. Paste it to open it.</p>
    <OpenLinkForm />
  </section>;
}
