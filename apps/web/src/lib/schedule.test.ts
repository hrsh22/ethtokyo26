import { describe, expect, it } from "vitest";
import { allocationTerms, maxClaimable, runLabel } from "./schedule";

describe("allowance schedules", () => {
  it("maps each choice to contract terms", () => {
    expect(allocationTerms("once", null)).toEqual({ period: 0 });
    expect(allocationTerms("day", null)).toEqual({ period: 1 });
    expect(allocationTerms("month", null)).toEqual({ period: 2 });
    expect(allocationTerms("minute", 5)).toEqual({ period: 3, schedule: { intervalSeconds: 60, durationSeconds: 300 } });
    expect(allocationTerms("day", 30)).toEqual({ period: 3, schedule: { intervalSeconds: 86_400, durationSeconds: 2_592_000 } });
  });
  it("refuses what the contract can't run", () => {
    for (const [frequency, runFor] of [["minute", null], ["month", 3], ["day", 366], ["day", 0], ["minute", 1.5]] as const) {
      expect(allocationTerms(frequency, runFor)).toHaveProperty("error");
    }
  });
  it("describes the run and its ceiling", () => {
    expect(runLabel("day", 30)).toBe("1 month");
    expect(runLabel("minute", 7)).toBe("7 minutes");
    expect(runLabel("day", null)).toBeNull();
    expect(maxClaimable({ period: 3, schedule: { intervalSeconds: 60, durationSeconds: 300 } }, BigInt(2))).toBe(BigInt(10));
    expect(maxClaimable({ period: 1 }, BigInt(2))).toBeUndefined();
  });
});
