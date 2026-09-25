"use client";

import { allocationWindow } from "@accord/chain";
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import type { AllocationData } from "@/lib/use-allocation";

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** When the claim window refills or ends. Projects forward from the last block; the chain still decides. */
export function WindowTimer({ data }: { data: AllocationData }) {
  const window = allocationWindow(data.allocation, data.blockTimestamp, data.schedule);
  const ticking = data.allocation[5] === 3 && !window.expired && !window.closed;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  if (window.closed || data.allocation[0] === "0x0000000000000000000000000000000000000000") return null;
  if (window.expired) return <span className="pill"><Clock size={14} />Claim window ended</span>;
  if (!window.nextResetAt) return null;
  if (!ticking) {
    const at = new Date(Number(window.nextResetAt) * 1000);
    const sameDay = at.toDateString() === new Date(now).toDateString();
    return <span className="pill"><Clock size={14} />Refills {sameDay ? "today" : at.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} at {at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>;
  }
  const projected = Number(data.blockTimestamp) + Math.max(0, (now - data.observedAt) / 1000);
  const left = (at: bigint) => Math.max(0, Math.ceil(Number(at) - projected));
  return <span className="pill" aria-live="polite"><Clock size={14} />
    {left(window.nextResetAt) > 0 ? `Refills in ${clock(left(window.nextResetAt))}` : "Waiting for the next block"}
    {window.endsAt ? `, ends in ${clock(left(window.endsAt))}` : ""}
  </span>;
}
