"use client";

import { motion, type Variants } from "motion/react";
import { Ban, Fingerprint, Globe, ShieldCheck } from "lucide-react";
import { allocationPalette } from "@/lib/palette";
import { Avatar } from "../avatar";
import { Ring } from "../ring";

const rise: Variants = {
  hidden: { opacity: 0, y: 40, rotate: 0 },
  show: (custom: { delay: number; rotate: number }) => ({ opacity: 1, y: 0, rotate: custom.rotate,
    transition: { type: "spring", stiffness: 120, damping: 16, delay: custom.delay } }),
};

/** The hero's one orchestrated moment: cards and stickers settle around a phone mid-claim. */
export function HeroArt() {
  const kenji = allocationPalette(BigInt(1), false);
  const agent = allocationPalette(BigInt(1), true);
  return <motion.div aria-hidden initial="hidden" animate="show" className="relative mx-auto h-[560px] w-full max-w-[560px] lg:h-[600px]">
    <motion.div variants={rise} custom={{ delay: 0.15, rotate: -8 }} className="absolute left-0 top-10 w-[230px] rounded-[1.75rem] p-5 shadow-pop" style={{ background: kenji.tile, color: kenji.ink }}>
      <div className="flex items-center gap-3"><Avatar kind="person" palette={kenji} size={44} /><span><b className="block">kenji.eth</b><small className="opacity-70">10 tUSDC a day</small></span></div>
      <p className="mt-5 font-display text-[40px] font-extrabold leading-none">62 <span className="text-lg opacity-70">left</span></p>
    </motion.div>
    <motion.div variants={rise} custom={{ delay: 0.3, rotate: 6 }} className="absolute left-[-10px] top-[290px] w-[236px] rounded-[1.75rem] p-5 shadow-pop sm:left-[-24px]" style={{ background: agent.tile, color: agent.ink }}>
      <div className="flex items-center gap-3"><Avatar kind="agent" palette={agent} size={44} /><span><b className="block">Research agent</b><small className="opacity-70">20 tUSDC a day</small></span></div>
      <div className="mt-4 flex h-12 items-end gap-1.5">{[30, 55, 40, 80, 45, 65].map((h, i) => <i key={i} className="flex-1 rounded-md" style={{ height: `${h}%`, background: i === 3 || i === 5 ? agent.ink : "rgb(29 18 64 / 0.18)" }} />)}</div>
    </motion.div>
    <motion.div variants={rise} custom={{ delay: 0, rotate: 0 }} className="absolute right-0 top-0 z-10 h-[560px] w-[280px] overflow-hidden rounded-[46px] border-[10px] border-ink bg-white shadow-pop sm:right-6">
      <span className="absolute left-1/2 top-2 h-6 w-[86px] -translate-x-1/2 rounded-full bg-ink" />
      <div className="flex justify-between px-5 pt-3 text-[13px] font-semibold"><b>9:41</b><span className="flex gap-1"><i className="h-2.5 w-3 rounded-sm bg-ink/70" /><i className="h-2.5 w-4 rounded-sm bg-ink" /></span></div>
      <div className="px-5 pt-7 text-center">
        <small className="text-muted">From Tokyo research collective</small>
        <div className="mt-6 flex justify-center"><Ring value={1} size={190} stroke={18} colors={kenji.ring} track="#f1f0f7" label="10 tUSDC ready">
          <b className="font-display text-[64px] font-extrabold leading-none">10</b><small className="text-muted">tUSDC ready</small>
        </Ring></div>
        <div className="mt-4 flex justify-center gap-2 text-[13px] font-semibold"><span className="rounded-full bg-soft px-3 py-1.5">62 left</span><span className="rounded-full bg-soft px-3 py-1.5">Refills 09:00</span></div>
      </div>
      <div className="absolute inset-x-4 bottom-6 flex items-center justify-center gap-2 rounded-full bg-ink py-4 font-semibold text-white"><Globe size={18} />Claim with World ID</div>
    </motion.div>
    <motion.span variants={rise} custom={{ delay: 0.55, rotate: 6 }} className="sticker absolute right-[-8px] top-24 z-20 bg-sky"><ShieldCheck size={16} strokeWidth={2.4} />Screened</motion.span>
    <motion.span variants={rise} custom={{ delay: 0.65, rotate: -8 }} className="sticker absolute left-4 top-[470px] z-20 bg-lime"><Fingerprint size={16} strokeWidth={2.4} />World ID verified</motion.span>
    <motion.span variants={rise} custom={{ delay: 0.75, rotate: 4 }} className="sticker absolute right-[-16px] top-[380px] z-20 bg-pink"><Ban size={16} strokeWidth={2.4} />Revoke any time</motion.span>
  </motion.div>;
}
