export type AllocationState = readonly [string, bigint, bigint, bigint, bigint, number, boolean];
export type AllocationSchedule = readonly [bigint, bigint, number];

/** Mirrors SpaceAccount's windows. Never replace chain-time checks with local time. */
export function allocationWindow(allocation: AllocationState, timestamp: bigint, schedule?: AllocationSchedule) {
  let periodId = 0n;
  let nextResetAt: bigint | undefined;
  let endsAt: bigint | undefined;
  let expired = false;
  if (allocation[5] === 3) {
    if (!schedule || schedule[2] < 60 || schedule[1] <= schedule[0] || timestamp < schedule[0]) throw new Error("Invalid allocation schedule");
    const [start, end, interval] = schedule;
    endsAt = end;
    expired = timestamp >= end;
    periodId = (timestamp - start) / BigInt(interval) + 1n;
    const next = start + periodId * BigInt(interval);
    if (!expired && next < end) nextResetAt = next;
  } else if (allocation[5] === 1) {
    periodId = timestamp / 86400n + 1n;
    nextResetAt = periodId * 86400n;
  } else if (allocation[5] === 2) {
    const date = new Date(Number(timestamp) * 1000);
    periodId = BigInt(date.getUTCFullYear() * 12 + date.getUTCMonth() + 1);
    nextResetAt = BigInt(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000);
  } else if (allocation[5] !== 0) throw new Error("Unknown allocation period");
  const spent = allocation[4] === periodId ? allocation[3] : 0n;
  const allowance = allocation[5] === 0 ? allocation[1] : allocation[2] > spent ? allocation[2] - spent : 0n;
  const available = expired || allocation[6] ? 0n : allowance < allocation[1] ? allowance : allocation[1];
  return { periodId, available, nextResetAt, endsAt, expired, closed: allocation[6] };
}
