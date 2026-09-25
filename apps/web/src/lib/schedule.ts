export type Frequency = "once" | "minute" | "day" | "month";
export type Terms = { period: 0 | 1 | 2 | 3; schedule?: { intervalSeconds: number; durationSeconds: number } };

const interval = { minute: 60, day: 86_400 } as const;
const unit = { minute: "minute", day: "day" } as const;
// SpaceAccount.createTimedAllocation accepts intervals of 60s–1 day and runs of up to 365 days.
const MAX_RUN_SECONDS = 365 * 86_400;

export const runPresets = {
  minute: [{ count: 5, label: "5 minutes" }, { count: 15, label: "15 minutes" }, { count: 60, label: "1 hour" }],
  day: [{ count: 7, label: "1 week" }, { count: 30, label: "1 month" }, { count: 90, label: "3 months" }],
} as const;

/**
 * Maps the owner's choice to contract terms. An end date needs a timed allocation
 * (rolling windows from funding); open-ended daily and monthly use calendar periods.
 * `runFor` counts intervals; null means no end.
 */
export function allocationTerms(frequency: Frequency, runFor: number | null): Terms | { error: string } {
  if (frequency === "once") return { period: 0 };
  if (frequency === "month") return runFor === null ? { period: 2 } : { error: "Monthly allowances can't have an end date. They run until you close them." };
  if (runFor === null) return frequency === "day" ? { period: 1 } : { error: "Choose how long a per-minute allowance runs." };
  if (!Number.isInteger(runFor) || runFor < 1) return { error: `Enter a whole number of ${unit[frequency]}s.` };
  const durationSeconds = interval[frequency] * runFor;
  if (durationSeconds > MAX_RUN_SECONDS) return { error: "A timed allowance can run for up to 365 days." };
  return { period: 3, schedule: { intervalSeconds: interval[frequency], durationSeconds } };
}

export function runLabel(frequency: Frequency, runFor: number | null) {
  if (frequency === "once" || frequency === "month" || runFor === null) return null;
  const preset = runPresets[frequency].find((item) => item.count === runFor);
  return preset?.label ?? `${runFor} ${unit[frequency]}${runFor === 1 ? "" : "s"}`;
}

/** The most that can be claimed before a timed allowance ends. */
export function maxClaimable(terms: Terms, cap: bigint) {
  return terms.schedule ? cap * BigInt(terms.schedule.durationSeconds / terms.schedule.intervalSeconds) : undefined;
}
