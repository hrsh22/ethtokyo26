import { cn } from "cn";
import { orbVars, type Palette } from "@/lib/palette";

/** A glossy orb for people and a little robot for agents, tinted by the allocation's palette. */
export function Avatar({ kind, palette, size = 48, className }: { kind: "person" | "agent"; palette: Palette; size?: number; className?: string }) {
  return <span aria-hidden className={cn(kind === "agent" ? "bot" : "orb", "inline-block", className)}
    style={{ ...orbVars(palette), width: size, height: size }} />;
}

export function Logo({ className }: { className?: string }) {
  return <span className={cn("inline-flex items-center gap-2 font-display text-[22px] font-extrabold tracking-tight", className)}>
    <span aria-hidden className="grid grid-cols-2 gap-[3px]">
      {["#FF8A4C", "#A98BFF", "#C4F26A", "#FF90C9"].map((color) => <i key={color} className="size-[9px] rounded-full" style={{ background: color }} />)}
    </span>
    accord
  </span>;
}
