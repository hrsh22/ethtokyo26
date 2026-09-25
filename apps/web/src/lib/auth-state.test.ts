import { describe, expect, it } from "vitest";
import { authStatus, isUnauthorized } from "./auth-state";

const state = { walletStatus: "connected", address: "0xAbC", queryStatus: "success" as const,
  session: { address: "0xabc", expiresAt: new Date(1_000_000_000_000).toISOString() } };

describe("wallet and Accord session state", () => {
  it("recognizes a valid restored session independent of address casing", () => {
    expect(authStatus(state, 1)).toBe("signed-in");
  });
  it("never treats a connected wallet alone as authenticated", () => {
    expect(authStatus({ ...state, session: null })).toBe("signed-out");
    expect(authStatus({ ...state, queryStatus: "pending" })).toBe("checking");
  });
  it("rejects expired sessions and sessions belonging to another wallet", () => {
    expect(authStatus(state, Date.parse(state.session.expiresAt) + 1)).toBe("signed-out");
    expect(authStatus({ ...state, address: "0xdef" }, 1)).toBe("signed-out");
    expect(authStatus({ ...state, walletStatus: "disconnected", address: undefined }, 1)).toBe("disconnected");
  });
  it("keeps restoration and API failures distinct from signing out", () => {
    expect(authStatus({ ...state, walletStatus: "reconnecting" }, 1)).toBe("connecting");
    expect(authStatus({ ...state, queryStatus: "error" }, 1)).toBe("unavailable");
    expect(isUnauthorized({ _tag: "Unauthorized" })).toBe(true);
    expect(isUnauthorized(new Error("Network failed"))).toBe(false);
  });
});
