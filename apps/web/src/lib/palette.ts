import type { CSSProperties } from "react";

export type Palette = {
  tile: string;
  ink: string;
  soft: string;
  orb: readonly [string, string, string];
  ring: readonly [string, string];
};

const people: Palette[] = [
  { tile: "linear-gradient(160deg,#FFB788,#FF8A4C 58%,#FF6F3D)", ink: "#2A1206", soft: "#FFF1E8", orb: ["#FFE3CC", "#FF8A4C", "#E2561C"], ring: ["#FF8A4C", "#FF90C9"] },
  { tile: "linear-gradient(160deg,#FFC6E2,#FF90C9 58%,#FF6FB5)", ink: "#3D0F26", soft: "#FFE3F1", orb: ["#FFE4F3", "#FF90C9", "#E0539A"], ring: ["#FF6FB5", "#FF8A4C"] },
  { tile: "linear-gradient(160deg,#E4FFAE,#C4F26A 58%,#A7E23E)", ink: "#243300", soft: "#EEFBD6", orb: ["#F4FFD9", "#C4F26A", "#7FB81F"], ring: ["#8BC51F", "#1C8A58"] },
];
const agents: Palette[] = [
  { tile: "linear-gradient(160deg,#CDBCFF,#A98BFF 60%,#8C67FF)", ink: "#1D1240", soft: "#EEE8FF", orb: ["#F1EBFF", "#A98BFF", "#6F4BEA"], ring: ["#8C67FF", "#7CC7FF"] },
  { tile: "linear-gradient(160deg,#C2E6FF,#7CC7FF 60%,#4AA8EE)", ink: "#0B2A45", soft: "#E2F4FF", orb: ["#E0F7FF", "#7CC7FF", "#3A8FD8"], ring: ["#4AA8EE", "#A98BFF"] },
];
const all = [...people, ...agents];

/** The same allocation keeps its colour on every screen: tile, claim page, receipt. */
export function allocationPalette(id: bigint, isAgent: boolean) {
  const list = isAgent ? agents : people;
  return list[Number((id - BigInt(1)) % BigInt(list.length))]!;
}

export function keyPalette(key: string) {
  let hash = 0;
  for (const char of key.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return all[hash % all.length]!;
}

export const orbVars = (palette: Palette) => ({ "--orb-hi": palette.orb[0], "--orb": palette.orb[1], "--orb-lo": palette.orb[2] }) as CSSProperties;
