import { allocationWindow } from "@accord/chain";
import { zeroAddress } from "viem";
import type { SpaceAllocation } from "./use-space-terms";

export type AllocationStatus = "active" | "needs-mandate" | "used-up" | "ended" | "closed";

/** Reserved funds and counts across a Space's open allocations. */
export function summarize(allocations: readonly SpaceAllocation[]) {
  const open = allocations.filter(({ allocation }) => !allocation[6]);
  return {
    reserved: open.reduce((sum, { allocation }) => sum + allocation[1], BigInt(0)),
    open: open.length,
    people: open.filter(({ allocation }) => allocation[0] !== zeroAddress).length,
    agents: open.filter(({ allocation }) => allocation[0] === zeroAddress).length,
  };
}

export function allocationStatus(entry: Pick<SpaceAllocation, "allocation" | "mandate" | "schedule" | "ensAuthorized">, timestamp: bigint): AllocationStatus {
  const { allocation, mandate, schedule } = entry;
  if (allocation[6]) return "closed";
  if (schedule && schedule[1] <= timestamp) return "ended";
  if (allocation[1] === BigInt(0)) return "used-up";
  if (allocation[0] === zeroAddress && !(mandate[9] && mandate[8] > timestamp && entry.ensAuthorized)) return "needs-mandate";
  return "active";
}

export const statusLabel: Record<AllocationStatus, string> = {
  active: "Active", "needs-mandate": "Needs mandate", "used-up": "Used up", ended: "Ended", closed: "Closed",
};

/**
 * How full the allocation's ring is. People: what they can claim now out of the period cap.
 * Agents: what's left of today's cap. Both mirror the contract's own window maths.
 */
export function ringProgress(entry: Pick<SpaceAllocation, "allocation" | "mandate" | "schedule">, timestamp: bigint) {
  const { allocation, mandate } = entry;
  if (allocation[0] === zeroAddress) {
    const today = timestamp / BigInt(86_400);
    const spent = mandate[7] === today ? mandate[6] : BigInt(0);
    const cap = mandate[4];
    const left = cap > spent ? cap - spent : BigInt(0);
    const available = left < allocation[1] ? left : allocation[1];
    return { available, cap, spent, fraction: cap > BigInt(0) ? Number(available * BigInt(1000) / cap) / 1000 : 0 };
  }
  let available = BigInt(0);
  try { available = allocationWindow(allocation, timestamp, entry.schedule).available; } catch { /* unreadable schedule */ }
  const cap = allocation[5] === 0 ? allocation[1] : allocation[2];
  return { available, cap, spent: cap > available ? cap - available : BigInt(0), fraction: cap > BigInt(0) ? Number(available * BigInt(1000) / cap) / 1000 : 0 };
}
