"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowLeft, ArrowUpRight, Bot, Eye, Plus, RotateCw, UserRound, Wallet } from "lucide-react";
import { zeroAddress } from "viem";
import { useAccord } from "@/lib/accord";
import { allocationAccess } from "@/lib/allocation-access";
import { shortAddress } from "@/lib/format";
import { allocationPalette } from "@/lib/palette";
import { summarize } from "@/lib/space-summary";
import { explorerAddress } from "@/lib/use-chain-actions";
import { useSpace } from "@/lib/use-space";
import { SpaceNamespace } from "../agent-identity";
import { Avatar } from "../avatar";
import { ShareButton } from "../share";
import { Button } from "../ui/button";
import { ActivityFeed } from "./activity-feed";
import { AllocationTile } from "./allocation-tile";

export function SpaceScreen({ address }: { address: string }) {
  const { auth, account, start } = useAccord();
  const space = useSpace(address);
  const terms = space.terms.data;
  const viewer = account ?? zeroAddress;
  const entries = terms?.allocations.toReversed() ?? [];
  const mine = !space.isOwner ? entries.filter((entry) => allocationAccess(entry, viewer, terms!.blockTimestamp).yours) : [];
  const others = entries.filter((entry) => !mine.includes(entry));
  const summary = terms ? summarize(terms.allocations) : null;
  const nameOf = (id: string) => {
    const entry = terms?.allocations.find((item) => item.id.toString() === id);
    return entry ? space.label(entry) : `Allocation ${id}`;
  };
  const role = space.isOwner ? "owner" : mine.length ? "recipient" : auth.signedIn ? "visitor" : "guest";
  const unsupported = space.meta.error instanceof Error && space.meta.error.message.includes("Only tUSDC Spaces");

  if (space.meta.isError) return <div role="alert" className="card mx-auto mt-10 max-w-xl p-8 text-center">
    <h1 className="font-display text-3xl font-extrabold">{unsupported ? "This Space isn’t available in Accord" : "We couldn’t read this Space"}</h1>
    <p className="mt-2 text-ink-soft">{unsupported ? "Accord now supports tUSDC Spaces only." : "Check the link. If it’s right, Sepolia may be slow; try again in a moment."}</p>
    {unsupported ? <Button asChild variant="soft" className="mt-5"><Link href="/spaces">Your Spaces</Link></Button>
      : <Button variant="soft" className="mt-5" onClick={() => void space.meta.refetch()}><RotateCw />Try again</Button>}
  </div>;

  return <div>
    {auth.signedIn ? <Link href="/spaces" className="mb-5 inline-flex items-center gap-2 font-semibold text-muted hover:text-ink"><ArrowLeft size={18} />Your Spaces</Link> : null}
    <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-end justify-between gap-6">
      <div className="min-w-0">
        <span className={`pill ${role === "owner" ? "bg-ink text-white" : role === "recipient" ? "bg-tang-soft text-[#b1461a]" : "bg-white"}`}>
          {role === "owner" ? "You own this Space" : role === "recipient" ? "Shared with you" : <><Eye size={14} />Public view</>}
        </span>
        <h1 className="mt-3 font-display text-[44px] font-extrabold leading-none tracking-[-0.03em] sm:text-[56px]">
          {space.titleKnown || space.meta.isError ? space.title : <span className="inline-block h-12 w-72 animate-pulse rounded-2xl bg-white/70" />}
        </h1>
        <SpaceNamespace draftId={space.draft.data?.id ?? space.profile.data?.id} />
        <p className="mt-3 text-lg text-ink-soft">
          <b className="font-display text-2xl font-extrabold text-ink">{summary ? space.units(summary.reserved) : "…"}</b> reserved
          {summary ? <> for {summary.people} {summary.people === 1 ? "person" : "people"} and {summary.agents} {summary.agents === 1 ? "agent" : "agents"}</> : null}
        </p>
        {space.meta.data ? <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <span className="pill bg-white/80">{space.symbol} on Sepolia</span>
          {!space.isOwner ? <span className="pill bg-white/80">Owner <span className="address">{shortAddress(space.meta.data.owner)}</span></span> : null}
          {explorerAddress(address) ? <a href={explorerAddress(address)} target="_blank" rel="noreferrer" className="pill bg-white/80 hover:bg-white">Contract <span className="address">{shortAddress(address)}</span><ArrowUpRight size={13} /></a> : null}
        </div> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <ShareButton path={`/spaces/${address}`} title="Share this Space" description="Send it to anyone. It shows the rules and activity, never the power to spend." />
        {space.isOwner ? <Button asChild><Link href={`/spaces/${address}/new`}><Plus />Give someone a budget</Link></Button> : null}
      </div>
    </motion.header>

    {!auth.signedIn ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 flex flex-wrap items-center gap-4 rounded-[1.75rem] bg-white/80 p-4 pl-5 shadow-float backdrop-blur">
      <span className="grid size-11 place-items-center rounded-2xl bg-tang-soft text-[#e2561c]"><Wallet size={20} /></span>
      <span className="min-w-[200px] flex-1"><b className="block">Was one of these sent to you?</b><span className="text-sm text-muted">Connect the wallet it was sent to, and you can claim or pay right here.</span></span>
      <Button onClick={start}>Connect wallet</Button>
    </motion.div> : role === "visitor" && terms && entries.length > 0 ? <p className="mt-6 rounded-[1.5rem] bg-white/70 px-5 py-4 text-sm text-ink-soft">
      Nothing here is assigned to <span className="address">{shortAddress(viewer)}</span>. If someone sent you a link, check you connected the wallet they used.
    </p> : null}

    <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid min-w-0 gap-8">
        {mine.length ? <section aria-labelledby="mine-heading">
          <h2 id="mine-heading" className="mb-4 font-display text-3xl font-extrabold">For you</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{mine.map((entry) => {
            const access = allocationAccess(entry, viewer, terms!.blockTimestamp);
            return <AllocationTile key={entry.id.toString()} spaceAddress={address} entry={entry} timestamp={terms!.blockTimestamp}
              label={space.label(entry)} units={space.units} yours action={access.canClaim ? "claim" : access.canPay ? "pay" : undefined} />;
          })}</div>
        </section> : null}

        <section aria-labelledby="all-heading">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="all-heading" className="font-display text-3xl font-extrabold">{space.isOwner ? "People and agents" : mine.length ? "Everyone else" : "People and agents"}</h2>
            {terms && terms.count > BigInt(20) ? <span className="text-sm text-muted">Latest 20 of {terms.count.toString()}</span> : null}
          </div>
          {space.terms.isPending ? <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map((i) => <div key={i} className="h-[300px] animate-pulse rounded-tile bg-white/70" />)}</div>
            : space.terms.isError ? <div role="alert" className="card flex items-center gap-4 p-6"><span className="flex-1">Allocations couldn’t be loaded from Sepolia.</span><Button variant="soft" onClick={() => void space.terms.refetch()}>Retry</Button></div>
            : entries.length === 0 ? space.isOwner ? <OwnerEmpty address={address} /> : <div className="card p-8 text-center"><p className="font-display text-2xl font-extrabold">No allocations yet</p><p className="mt-1 text-muted">The owner hasn’t given anyone a budget here yet.</p></div>
            : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {others.map((entry) => <AllocationTile key={entry.id.toString()} spaceAddress={address} entry={entry} timestamp={terms!.blockTimestamp} label={space.label(entry)} units={space.units} />)}
              {space.isOwner ? <Link href={`/spaces/${address}/new`} className="grid min-h-[300px] place-content-center justify-items-center gap-3 rounded-tile border-[2.5px] border-dashed border-[#c9c4dd] text-center font-semibold text-muted transition-colors hover:border-ink/40 hover:text-ink">
                <span className="grid size-12 place-items-center rounded-full bg-white text-ink shadow-float"><Plus /></span>Give someone<br />a budget
              </Link> : null}
            </div>}
        </section>
      </div>
      <aside className="lg:sticky lg:top-28"><ActivityFeed spaceAddress={address} units={space.units} nameOf={nameOf} /></aside>
    </div>
  </div>;
}

function OwnerEmpty({ address }: { address: string }) {
  const options = [
    { kind: "person" as const, href: `/spaces/${address}/new?for=person`, icon: UserRound, title: "A person", body: "An allowance they claim with World ID, daily, monthly or all at once." },
    { kind: "agent" as const, href: `/spaces/${address}/new?for=agent`, icon: Bot, title: "An agent", body: "A named agent with a revocable budget and owner approval for larger payments." },
  ];
  return <div className="grid gap-4 sm:grid-cols-2">
    {options.map((option) => {
      const palette = allocationPalette(BigInt(1), option.kind === "agent");
      return <motion.div key={option.kind} whileHover={{ y: -4 }}>
        <Link href={option.href} className="relative flex min-h-[300px] flex-col overflow-hidden rounded-tile p-7 shadow-float" style={{ background: palette.tile, color: palette.ink }}>
          <Avatar kind={option.kind} palette={palette} size={60} />
          <span className="mt-auto"><span className="pill mb-3"><option.icon size={14} />Give a budget to</span>
            <b className="block font-display text-4xl font-extrabold leading-none">{option.title}</b>
            <span className="mt-2 block opacity-80">{option.body}</span></span>
        </Link>
      </motion.div>;
    })}
  </div>;
}
