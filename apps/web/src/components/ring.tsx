"use client";

import { motion } from "motion/react";
import { useId } from "react";

/** Progress ring that sweeps to its value. Value is clamped to 0–1. */
export function Ring({ value, size = 220, stroke = 20, colors, track = "rgb(255 255 255 / 0.35)", children, label }: {
  value: number; size?: number; stroke?: number; colors: readonly [string, string]; track?: string;
  children?: React.ReactNode; label: string;
}) {
  const id = useId();
  const radius = (size - stroke) / 2;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={colors[0]} /><stop offset="1" stopColor={colors[1]} /></linearGradient></defs>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} strokeWidth={stroke} />
      {clamped > 0 ? <motion.circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={`url(#${id})`} strokeWidth={stroke} strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: clamped }} transition={{ type: "spring", stiffness: 60, damping: 18, delay: 0.1 }} /> : null}
    </svg>
    <div className="absolute inset-0 grid place-content-center text-center">{children}</div>
  </div>;
}
