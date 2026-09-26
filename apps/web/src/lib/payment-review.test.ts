import { describe, expect, it } from "vitest";
import { paymentReview } from "./payment-review";

describe("payment approval state", () => {
  it("waits through verification and enables continuation only after owner consent", () => {
    expect(paymentReview(undefined).ready).toBe(false);
    for (const status of ["pending", "verified"] as const) {
      expect(paymentReview(status)).toMatchObject({ ready: false, waiting: true });
    }
    for (const status of ["approved", "issued"] as const) {
      expect(paymentReview(status)).toMatchObject({ ready: true, waiting: false });
    }
  });
  it("never offers another payment for terminal requests", () => {
    for (const status of ["denied", "cancelled", "expired", "invalidated"] as const) {
      expect(paymentReview(status)).toMatchObject({ ready: false, stopped: true });
    }
    expect(paymentReview("executed")).toMatchObject({ ready: false, completed: true });
  });
});
