import { formatUnits, zeroAddress } from "viem";
import type { AllocationSchedule } from "@accord/chain";

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** Exact token amount for display: grouped, at most four decimals, never rounded up. */
export function amount(value: bigint, decimals?: number, symbol?: string) {
  if (decimals === undefined) return `${value} base units`;
  const [whole = "0", fraction = ""] = formatUnits(value, decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const kept = fraction.slice(0, 4).replace(/0+$/, "");
  const text = kept ? `${grouped}.${kept}` : value > BigInt(0) && whole === "0" ? "<0.0001" : grouped;
  return symbol ? `${text} ${symbol}` : text;
}

export function every(seconds: number) {
  if (seconds % 86_400 === 0) return seconds === 86_400 ? "day" : `${seconds / 86_400} days`;
  if (seconds % 3_600 === 0) return seconds === 3_600 ? "hour" : `${seconds / 3_600} hours`;
  if (seconds % 60 === 0) return seconds === 60 ? "minute" : `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

export const shortDate = (seconds: bigint | number) =>
  new Date(Number(seconds) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function timeAgo(seconds: number, now = Date.now() / 1000) {
  const diff = Math.max(0, Math.round(now - seconds));
  if (diff < 45) return "just now";
  if (diff < 3_600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.round(diff / 3_600)}h ago`;
  if (diff < 7 * 86_400) return `${Math.round(diff / 86_400)}d ago`;
  return new Date(seconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

type Allocation = readonly [string, bigint, bigint, bigint, bigint, number, boolean];
type Mandate = readonly [string, string, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean];

/** One plain sentence describing what the recipient may do. The contract remains the source of truth. */
export function ruleSentence(entry: { allocation: Allocation; mandate: Mandate; schedule?: AllocationSchedule },
  decimals?: number, symbol?: string) {
  const [beneficiary, remaining, cap, , , period] = entry.allocation;
  const units = (value: bigint) => amount(value, decimals, symbol);
  if (beneficiary === zeroAddress) {
    const [, , , , dailyCap, maxPerPayment, , , expiry, active] = entry.mandate;
    if (!active) return "An agent budget. It can't pay anyone until you grant a mandate.";
    return `Pays screened recipients up to ${units(maxPerPayment)} at a time and ${units(dailyCap)} a day, until ${shortDate(expiry)}.`;
  }
  if (period === 0) return `Can claim what's left, ${units(remaining)}, with a fresh World ID check each time.`;
  const per = period === 1 ? "a day" : period === 2 ? "a month" : entry.schedule ? `every ${every(entry.schedule[2])}` : "per window";
  return `Can claim up to ${units(cap)} ${per}, with a fresh World ID check each time.`;
}

export const periodName = (period: number) => ["All at once", "Every day", "Every month", "Every minute"][period] ?? "Custom";

export type NameEntry = { allocationId: string; name: string; address: string };

/** People show their ENS name or address; agent budgets show the ENS name their mandate was granted under. */
export function allocationLabel(entry: { id: bigint; allocation: Allocation; mandate: Mandate }, names?: readonly NameEntry[]) {
  const isAgent = entry.allocation[0] === zeroAddress;
  const recipient = isAgent ? entry.mandate[0] : entry.allocation[0];
  if (isAgent && recipient === zeroAddress) return "Agent budget";
  const saved = names?.find((item) => item.allocationId === entry.id.toString() && item.address.toLowerCase() === recipient.toLowerCase());
  return saved?.name ?? (isAgent ? `Agent ${shortAddress(recipient)}` : shortAddress(recipient));
}
