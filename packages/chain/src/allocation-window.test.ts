import { describe, expect, it } from "vitest";
import { allocationWindow, type AllocationState } from "./allocation-window";
import { hashTimedAllocationTerms } from "./permit";

const allocation: AllocationState = ["person", 40n, 10n, 10n, 1n, 3, false];
const schedule = [1007n, 1307n, 60] as const;
describe("timed allocation availability", () => {
  it.each([[1007n, 0n, 1n], [1066n, 0n, 1n], [1067n, 10n, 2n], [1247n, 10n, 5n], [1306n, 10n, 5n], [1307n, 0n, 6n]])(
    "mirrors contract windows at %s", (timestamp, available, periodId) => {
      expect(allocationWindow(allocation, timestamp, schedule)).toMatchObject({ available, periodId, expired: timestamp >= 1307n });
    });
  it("does not advertise a sixth window", () => {
    expect(allocationWindow(allocation, 1247n, schedule).nextResetAt).toBeUndefined();
    expect(allocationWindow(allocation, 1007n, schedule).nextResetAt).toBe(1067n);
  });
  it("caps availability to remaining funds and handles closure", () => {
    expect(allocationWindow(["person", 3n, 10n, 0n, 0n, 3, false], 1007n, schedule).available).toBe(3n);
    expect(allocationWindow([...allocation.slice(0, 6), true] as unknown as AllocationState, 1067n, schedule).available).toBe(0n);
  });
  it("fails closed when schedule data is unavailable", () => {
    expect(() => allocationWindow(allocation, 1067n)).toThrow();
  });
  it("keeps legacy daily and monthly boundaries", () => {
    const daily: AllocationState = ["person", 40n, 10n, 10n, 1n, 1, false];
    expect(allocationWindow(daily, 86399n).available).toBe(0n);
    expect(allocationWindow(daily, 86400n).available).toBe(10n);
    const before = BigInt(Date.UTC(2026, 8, 30, 23, 59, 59) / 1000);
    const monthly: AllocationState = ["person", 40n, 10n, 10n, 2026n * 12n + 9n, 2, false];
    expect(allocationWindow(monthly, before).available).toBe(0n);
    expect(allocationWindow(monthly, before + 1n).available).toBe(10n);
  });
  it("binds both interval and duration to the signed terms", () => {
    const hash = hashTimedAllocationTerms(10n, 60, 300);
    expect(hashTimedAllocationTerms(10n, 60, 600)).not.toBe(hash);
    expect(hashTimedAllocationTerms(10n, 120, 300)).not.toBe(hash);
  });
});
