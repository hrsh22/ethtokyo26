import { describe, expect, it } from "vitest";
import { zeroAddress } from "viem";
import { agentBudget, personal, space, timestamp } from "../../test/space-fixtures";
import { parseAmount } from "./amounts";
import { describeError } from "./errors";
import { allocationLabel, amount, every, ruleSentence } from "./format";
import { parseAccordLink } from "./links";
import { allocationPalette } from "./palette";
import { allocationStatus, ringProgress, summarize } from "./space-summary";

describe("amounts people type and read", () => {
  it("formats exact token amounts without rounding up", () => {
    expect(amount(BigInt(1_234_567_891), 6, "USDC")).toBe("1,234.5678 USDC");
    expect(amount(BigInt(10e6), 6)).toBe("10");
    expect(amount(BigInt(1), 6)).toBe("<0.0001");
    expect(amount(BigInt(5), undefined)).toBe("5 base units");
  });
  it("rejects amounts the token can't represent instead of rounding them", () => {
    expect(parseAmount("2.5", 6)).toEqual({ ok: true, value: BigInt(2_500_000) });
    expect(parseAmount("1,000", 6)).toEqual({ ok: true, value: BigInt(1_000e6) });
    expect(parseAmount("0.1234567", 6).ok).toBe(false);
    expect(parseAmount("0", 6).ok).toBe(false);
    expect(parseAmount("-1", 6).ok).toBe(false);
    expect(parseAmount("1e3", 6).ok).toBe(false);
    expect(parseAmount("5", undefined).ok).toBe(false);
  });
});

describe("rules in plain words", () => {
  it("describes person and agent allocations from their onchain terms", () => {
    expect(ruleSentence(personal, 6, "USDC")).toBe("Can claim up to 200 USDC a month, with a fresh World ID check each time.");
    expect(ruleSentence(agentBudget, 6, "USDC")).toMatch(/^Pays screened recipients up to 10 USDC at a time and 50 USDC a day, until /);
    const inactive = { ...agentBudget, mandate: [...agentBudget.mandate] as [...typeof agentBudget.mandate] };
    inactive.mandate[9] = false;
    expect(ruleSentence(inactive, 6, "USDC")).toMatch(/can't pay anyone until you grant a mandate/);
    expect(every(60)).toBe("minute");
    expect(every(86_400 * 2)).toBe("2 days");
  });
});

describe("names on tiles", () => {
  it("uses saved ENS names only for the wallet they were saved for", () => {
    const [agentWallet] = agentBudget.mandate;
    const names = [{ allocationId: "2", name: "agent.eth", address: agentWallet }, { allocationId: "1", name: "family.eth", address: zeroAddress }];
    expect(allocationLabel(agentBudget, names)).toBe("agent.eth");
    expect(allocationLabel(personal, names)).toBe("0x2222…2222");
    expect(allocationLabel({ ...agentBudget, mandate: [zeroAddress, ...agentBudget.mandate.slice(1)] as unknown as typeof agentBudget.mandate }, names)).toBe("Agent budget");
    expect(allocationLabel(agentBudget)).toBe("Agent 0x3333…3333");
  });
});

describe("tiles and rings", () => {
  it("sums only open allocations and counts people and agents", () => {
    const closed = { ...personal, id: BigInt(9), allocation: [...personal.allocation] as [...typeof personal.allocation] };
    closed.allocation[6] = true;
    expect(summarize([personal, agentBudget, closed])).toEqual({ reserved: BigInt(1700e6), open: 2, people: 1, agents: 1 });
  });
  it("shows what can be used now, capped by the period or today's limit", () => {
    expect(ringProgress(personal, timestamp)).toMatchObject({ available: BigInt(200e6), cap: BigInt(200e6), fraction: 1 });
    expect(ringProgress(agentBudget, timestamp)).toMatchObject({ available: BigInt(50e6), cap: BigInt(50e6), fraction: 1 });
    const today = timestamp / BigInt(86_400);
    const spent = { ...agentBudget, mandate: [...agentBudget.mandate] as [...typeof agentBudget.mandate] };
    spent.mandate[6] = BigInt(40e6); spent.mandate[7] = today;
    expect(ringProgress(spent, timestamp)).toMatchObject({ available: BigInt(10e6), fraction: 0.2 });
  });
  it("labels agents without a live mandate so owners know what to fix", () => {
    expect(allocationStatus(agentBudget, timestamp)).toBe("active");
    expect(allocationStatus({ ...agentBudget, ensAuthorized: false }, timestamp)).toBe("needs-mandate");
    expect(allocationStatus(personal, timestamp)).toBe("active");
  });
  it("keeps an allocation's colour stable across screens", () => {
    expect(allocationPalette(BigInt(4), false)).toBe(allocationPalette(BigInt(1), false));
    expect(allocationPalette(BigInt(1), true)).not.toBe(allocationPalette(BigInt(1), false));
  });
});

describe("links and errors", () => {
  it("opens Spaces and allocations from pasted links or bare addresses", () => {
    expect(parseAccordLink(`https://accord.example/spaces/${space}/a/12?x=1`)).toBe(`/spaces/${space}/a/12`);
    expect(parseAccordLink(`  ${space.toLowerCase()} `)).toBe(`/spaces/${space}`);
    expect(parseAccordLink(zeroAddress.slice(0, 20))).toBeNull();
    expect(parseAccordLink("kenji.eth")).toBeNull();
  });
  it("turns wallet and API failures into short next steps", () => {
    expect(describeError({ _tag: "ServiceUnavailable" }, "x")).toMatch(/nothing was submitted/);
    expect(describeError(Object.assign(new Error("boom\nRequest Arguments: 0xdead"), { shortMessage: "User rejected the request." }), "x")).toMatch(/cancelled/);
    expect(describeError(new Error(JSON.stringify({ _tag: "Forbidden" })), "Nope.")).toMatch(/^Nope\. Check/);
    expect(describeError(new Error("Execution reverted\nDetails: long"), "x")).toBe("Execution reverted");
  });
});
