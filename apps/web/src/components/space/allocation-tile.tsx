"use client";

import Link from "next/link";
import { ArrowUpRight, Fingerprint, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { zeroAddress } from "viem";
import { allocationPalette } from "@/lib/palette";
import { allocationStatus, ringProgress, statusLabel } from "@/lib/space-summary";
import type { SpaceAllocation } from "@/lib/use-space-terms";
import { Avatar } from "../avatar";
import { Ring } from "../ring";

/** One person or agent in a Space. The colour and avatar carry through to their own page. */
export function AllocationTile({ spaceAddress, entry, timestamp, label, units, yours = false, action }: {
  spaceAddress: string; entry: SpaceAllocation; timestamp: bigint; label: string; units: (value: bigint) => string;
  yours?: boolean; action?: "claim" | "pay";
}) {
  const isAgent = entry.allocation[0] === zeroAddress;
  const palette = allocationPalette(entry.id, isAgent);
  const status = allocationStatus(entry, timestamp);
  const live = status === "active";
  const ring = ringProgress(entry, timestamp);
  const [, remaining, cap, , , period] = entry.allocation;
  const facts = status === "closed" ? ["Unspent funds returned"] : isAgent
    ? [entry.mandate[9] ? `${units(entry.mandate[5])} max each` : "No mandate yet", `${units(remaining)} left`]
    : [period === 0 ? "Any time" : `${units(cap)} ${period === 1 ? "a day" : period === 2 ? "a month" : "a window"}`, `${units(remaining)} left`];
  return <motion.div layout initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -4 }} transition={{ type: "spring", stiffness: 300, damping: 26 }}>
    <Link href={`/spaces/${spaceAddress}/a/${entry.id}`} aria-label={`${label}, ${isAgent ? "agent" : "person"}, ${statusLabel[status]}`}
      className={`relative flex min-h-[300px] flex-col overflow-hidden rounded-tile p-6 ${live ? "shadow-float" : "bg-white/70"} ${yours ? "ring-4 ring-white" : ""}`}
      style={live ? { background: palette.tile, color: palette.ink } : undefined}>
      {live ? <div className="blob -bottom-20 -right-20 size-56 opacity-60" style={{ background: palette.soft }} /> : null}
      <div className="relative flex items-center gap-3">
        <Avatar kind={isAgent ? "agent" : "person"} palette={palette} size={48} className={live ? "" : "opacity-50 grayscale"} />
        <span className="min-w-0 flex-1"><b className="block truncate text-lg font-semibold leading-tight">{label}</b>
          <small className="opacity-70">{isAgent ? "Agent" : "Person"}{yours ? ", yours" : ""}</small></span>
        <span className={`pill ${live ? "" : "bg-soft text-muted"}`}>{isAgent && live ? <ShieldCheck size={13} /> : null}{statusLabel[status]}</span>
      </div>
      <div className="relative my-5 flex justify-center">
        <Ring value={live ? ring.fraction : 0} size={150} stroke={16} colors={live ? ["#fff", "#fff"] : ["#c9c4dd", "#c9c4dd"]}
          track={live ? "rgb(255 255 255 / 0.3)" : "var(--color-line)"} label={`${units(ring.available)} available ${isAgent ? "today" : "now"}`}>
          <b className="font-display text-[34px] font-extrabold leading-none">{units(ring.available).split(" ")[0]}</b>
          <small className="text-[12px] font-semibold opacity-70">{isAgent ? "left today" : "ready now"}</small>
        </Ring>
      </div>
      <div className="relative mt-auto flex flex-wrap items-center gap-2">
        {facts.map((fact) => <span key={fact} className={`pill ${live ? "" : "bg-soft"}`}>{fact}</span>)}
        {action ? <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">
          {action === "claim" ? <Fingerprint size={15} /> : null}{action === "claim" ? "Claim" : "Pay"}<ArrowUpRight size={15} />
        </span> : null}
      </div>
    </Link>
  </motion.div>;
}
