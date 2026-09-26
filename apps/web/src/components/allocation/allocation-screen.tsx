"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowLeft, Bot, RotateCw, UserRound } from "lucide-react";
import { zeroAddress } from "viem";
import { AgentIdentityCard } from "../agent-identity";
import { useAccord } from "@/lib/accord";
import { allocationAccess } from "@/lib/allocation-access";
import { periodUnit, ruleSentence, shortAddress, shortDate } from "@/lib/format";
import { allocationPalette } from "@/lib/palette";
import { allocationStatus, ringProgress, statusLabel } from "@/lib/space-summary";
import { useAllocation } from "@/lib/use-allocation";
import { useSpace } from "@/lib/use-space";
import { Avatar } from "../avatar";
import { ResearchPurchase } from "../research-purchase";
import { Ring } from "../ring";
import { SignInCard } from "../sign-in-card";
import { ActivityFeed } from "../space/activity-feed";
import { Button } from "../ui/button";
import { ClaimPanel } from "./claim-panel";
import { OwnerPanel } from "./owner-panel";
import { PayPanel } from "./pay-panel";
import { WindowTimer } from "./window-timer";

export function AllocationScreen({ address, id }: { address: string; id: bigint }) {
  const { auth, account, client } = useAccord();
  const space = useSpace(address);
  const query = useAllocation(address, id);
  const data = query.data;
  const unsupported = space.meta.error instanceof Error && space.meta.error.message.includes("Only tUSDC Spaces");
  const back = <Link href={`/spaces/${address}`} className="mb-5 inline-flex items-center gap-2 font-semibold text-muted hover:text-ink"><ArrowLeft size={18} />{space.title}</Link>;

  if (query.isPending || space.meta.isPending) return <div>{back}<div className="grid gap-6 lg:grid-cols-[1fr_1fr]"><div className="h-[520px] animate-pulse rounded-tile bg-white/70" /><div className="h-[420px] animate-pulse rounded-tile bg-white/70" /></div></div>;
  if (query.isError || space.meta.isError) return <div>{back}<div role="alert" className="card p-8">
    <h1 className="font-display text-3xl font-extrabold">{unsupported ? "This allocation isn’t available in Accord" : "We couldn’t read this from Sepolia"}</h1>
    {unsupported ? <p className="mt-2 text-ink-soft">Accord now supports tUSDC Spaces only.</p> : null}
    {unsupported ? <Button asChild variant="soft" className="mt-4"><Link href="/spaces">Your Spaces</Link></Button>
      : <Button variant="soft" className="mt-4" onClick={() => void query.refetch()}><RotateCw />Try again</Button>}</div></div>;
  if (!data) return <div>{back}<div className="card p-8"><h1 className="font-display text-3xl font-extrabold">This allocation doesn’t exist</h1>
    <p className="mt-2 text-ink-soft">Check the link. Allocation {id.toString()} isn’t in this Space.</p></div></div>;

  const isAgent = data.allocation[0] === zeroAddress;
  const palette = allocationPalette(id, isAgent);
  const status = allocationStatus(data, data.blockTimestamp);
  const live = status === "active";
  const ring = ringProgress(data, data.blockTimestamp);
  const label = space.label(data);
  const access = allocationAccess(data, account ?? zeroAddress, data.blockTimestamp);
  const owner = space.isOwner;
  const draftId = space.draft.data?.id;
  const [, remaining, cap, , , period] = data.allocation;

  return <div>
    {back}
    {isAgent ? <div className="mb-5"><AgentIdentityCard draftId={draftId ?? space.profile.data?.id} allocationId={id.toString()} owner={owner} /></div> : null}
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} aria-labelledby="allocation-title"
        className="relative overflow-hidden rounded-[2.5rem] p-7 shadow-float sm:p-9 lg:sticky lg:top-28"
        style={live ? { background: palette.tile, color: palette.ink } : { background: "#fff" }}>
        <div className="blob -bottom-24 -right-24 size-72 opacity-70" style={{ background: palette.soft }} />
        <div className="relative flex items-start gap-4">
          <Avatar kind={isAgent ? "agent" : "person"} palette={palette} size={68} className={live ? "" : "grayscale"} />
          <div className="min-w-0 flex-1">
            <h1 id="allocation-title" className="break-words font-display text-[32px] font-extrabold leading-none tracking-[-0.03em] sm:text-[40px]">{isAgent && label.endsWith(".eth") ? label.split(".")[0] : label}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm opacity-75 sm:text-base">{isAgent ? <Bot size={16} className="shrink-0" /> : <UserRound size={16} className="shrink-0" />}{isAgent ? "Agent budget" : "Allowance"} in {space.title}</p>
            <span className={`pill mt-3 ${live ? "" : "bg-soft text-muted"}`}>{statusLabel[status]}</span>
          </div>
        </div>
        <div className="relative my-8 flex justify-center">
          <Ring value={live ? ring.fraction : 0} size={260} stroke={24} colors={live ? ["#fff", "#fff"] : ["#c9c4dd", "#c9c4dd"]}
            track={live ? "rgb(255 255 255 / 0.3)" : "var(--color-line)"} label={`${space.units(live ? ring.available : BigInt(0))} available`}>
            <b className="font-display text-[76px] font-extrabold leading-none">{space.units(live ? ring.available : BigInt(0)).split(" ")[0]}</b>
            <span className="font-semibold opacity-75">{status === "ens-inactive" ? "Payments paused" : `${space.symbol} ${isAgent ? "left today" : "ready now"}`}</span>
          </Ring>
        </div>
        <p className="relative text-center text-lg font-medium">{ruleSentence(data, space.decimals, space.symbol)}</p>
        <div className="relative mt-5 flex flex-wrap justify-center gap-2">
          <span className="pill">{space.units(remaining)} left in total</span>
          {!isAgent && period !== 0 ? <span className="pill">{space.units(cap)} per {periodUnit(period, data.schedule)}</span> : null}
          {isAgent && data.mandate[9] ? <span className="pill">Ends {shortDate(data.mandate[8])}</span> : null}
          <WindowTimer data={data} />
        </div>
        <p className="relative mt-5 text-center text-sm opacity-70">{isAgent ? data.mandate[0] !== zeroAddress ? <>Agent wallet <span className="address">{shortAddress(data.mandate[0])}</span></> : "No agent wallet yet"
          : <>Only <span className="address">{shortAddress(data.allocation[0])}</span> can claim</>}</p>
      </motion.section>

      <div className="grid min-w-0 grid-cols-1 gap-4">
        {!auth.signedIn ? <SignInCard compact title={isAgent ? "Is this your agent?" : "Is this for you?"}
          body={`Connect ${isAgent ? "the agent’s wallet" : shortAddress(data.allocation[0])} to ${isAgent ? "pay" : "claim"}. Anyone can view these rules.`} /> : null}
        {auth.signedIn && access.yours ? !draftId ? space.draft.isPending ? <div className="h-64 animate-pulse rounded-tile bg-white/70" />
          : <div className="card p-6"><h2 className="font-display text-2xl font-extrabold">This Space isn’t linked to Accord here</h2><p className="mt-1 text-muted">It exists onchain, but this deployment can’t sign claims or payments for it.</p></div>
          : isAgent ? <>
            {access.canPay ? <PayPanel address={address} draftId={draftId} data={data} decimals={space.decimals} symbol={space.symbol} units={space.units} />
              : <div className="card p-6"><h2 className="font-display text-2xl font-extrabold">Payments are paused</h2><p className="mt-1 text-muted">{status === "needs-mandate" ? "The owner needs to grant or renew this agent’s mandate." : status === "closed" ? "This budget is closed." : !data.ensAuthorized ? "The agent’s ENS identity is revoked or expired." : "Today’s limit or the budget is used up."}</p></div>}
            {access.canPay && client ? <ResearchPurchase client={client} draftId={draftId} allocationId={id.toString()} decimals={space.decimals} symbol={space.symbol} account={account!} /> : null}
          </> : status === "active" || status === "used-up" ? <ClaimPanel address={address} draftId={draftId} data={data} decimals={space.decimals} symbol={space.symbol} units={space.units} palette={palette} />
            : <div className="card p-6"><h2 className="font-display text-2xl font-extrabold">{statusLabel[status]}</h2><p className="mt-1 text-muted">This allowance can’t be claimed any more.</p></div>
          : null}
        {auth.signedIn && owner && !draftId && !space.draft.isPending && !access.yours ? <div className="card p-6"><h2 className="font-display text-2xl font-extrabold">This Space isn’t linked to Accord here</h2><p className="mt-1 text-muted">You own it onchain, but this Accord deployment has no record of it, so it can’t sign changes.</p></div> : null}
        {auth.signedIn && owner && draftId ? <OwnerPanel address={address} draftId={draftId} data={data} label={label} decimals={space.decimals} symbol={space.symbol} units={space.units} /> : null}
        {auth.signedIn && !owner && !access.yours ? <div className="card p-6"><h2 className="font-display text-2xl font-extrabold">This isn’t assigned to your wallet</h2>
          <p className="mt-1 text-muted">Only {isAgent ? "the agent’s wallet" : <span className="address">{shortAddress(data.allocation[0])}</span>} can {isAgent ? "pay" : "claim"}. If someone sent you this link, switch to the wallet they used.</p></div> : null}
        <ActivityFeed spaceAddress={address} units={space.units} nameOf={() => label} allocationId={id.toString()} title="History" />
      </div>
    </div>
  </div>;
}
