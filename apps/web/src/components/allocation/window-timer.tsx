"use client";

import { allocationWindow } from "@accord/chain";
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { shortDateTime } from "@/lib/format";
import type { AllocationData } from "@/lib/use-allocation";

const pad = (value: number) => String(value).padStart(2, "0");
const clock = (seconds: number) => seconds >= 3_600
  ? `${Math.floor(seconds / 3_600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}` : `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;

/** When the claim window refills or ends. Projects forward from the last block; the chain still decides. */
export function WindowTimer({ data }: { data: AllocationData }) {
  const window = allocationWindow(data.allocation, data.blockTimestamp, data.schedule);
  // A live countdown only helps for short windows; daily ones show the refill time and end date instead.
  const ticking = data.allocation[5] === 3 && !!data.schedule && data.schedule[2] < 3_600 && !window.expired && !window.closed;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  if (window.closed || data.allocation[0] === "0x0000000000000000000000000000000000000000") return null;
  if (window.expired) return <span className="pill"><Clock size={14} />Claim window ended</span>;
  if (!window.nextResetAt && !window.endsAt) return null;
  if (!ticking) {
    const at = window.nextResetAt ? new Date(Number(window.nextResetAt) * 1000) : null;
    const sameDay = at?.toDateString() === new Date(now).toDateString();
    return <>
      {at ? <span className="pill"><Clock size={14} />Refills {sameDay ? "today" : at.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} at {at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span> : null}
      {window.endsAt ? <span className="pill">Ends {shortDateTime(window.endsAt)}</span> : null}
    </>;
  }
  const projected = Number(data.blockTimestamp) + Math.max(0, (now - data.observedAt) / 1000);
  const left = (at: bigint) => Math.max(0, Math.ceil(Number(at) - projected));
  const refill = window.nextResetAt ? left(window.nextResetAt) > 0 ? `Refills in ${clock(left(window.nextResetAt))}` : "Waiting for the next block" : "Last window";
  return <span className="pill" aria-live="polite"><Clock size={14} />
    {refill}{window.endsAt ? `, ends in ${clock(left(window.endsAt))}` : ""}
  </span>;
}
