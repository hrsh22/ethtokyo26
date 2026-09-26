import { describe, expect, it } from "vitest";
import { allocationAccess } from "./allocation-access";
import { agent, agentBudget, owner, personal, recipient, timestamp } from "../../test/space-fixtures";

describe("allocation actions by wallet role", () => {
  it("keeps personal and agent access separate when both are assigned to one wallet", () => {
    const sharedAgent = { ...agentBudget, mandate: [...agentBudget.mandate] as [...typeof agentBudget.mandate] };
    sharedAgent.mandate[0] = recipient;
    expect(allocationAccess(personal, recipient, timestamp)).toMatchObject({ yours: true, canClaim: true, canPay: false });
    expect(allocationAccess(sharedAgent, recipient, timestamp)).toMatchObject({ yours: true, canClaim: false, canPay: true });
  });
  it("lets the beneficiary claim without giving the owner beneficiary access", () => {
    expect(allocationAccess(personal, recipient, timestamp)).toMatchObject({ yours: true, canClaim: true, canPay: false });
    expect(allocationAccess(personal, owner, timestamp)).toMatchObject({ yours: false, canClaim: false, canPay: false });
  });
  it("requires an active, unexpired and ENS-authorized mandate for agent payments", () => {
    expect(allocationAccess(agentBudget, agent, timestamp).canPay).toBe(true);
    expect(allocationAccess(agentBudget, recipient, timestamp).canPay).toBe(false);
    expect(allocationAccess(agentBudget, agent, agentBudget.mandate[8]).canPay).toBe(false);
    expect(allocationAccess({ ...agentBudget, ensAuthorized: false }, agent, timestamp).canPay).toBe(false);
    const revoked = { ...agentBudget, mandate: [...agentBudget.mandate] as [...typeof agentBudget.mandate] };
    revoked.mandate[9] = false;
    expect(allocationAccess(revoked, agent, timestamp).canPay).toBe(false);
  });
  it("keeps closed or exhausted allocations visible but removes spend actions", () => {
    for (const entry of [personal, agentBudget]) {
      const account = entry === personal ? recipient : agent;
      const closed = { ...entry, allocation: [...entry.allocation] as [...typeof entry.allocation] };
      closed.allocation[6] = true;
      expect(allocationAccess(closed, account, timestamp)).toMatchObject({ yours: true, canClaim: false, canPay: false });
      const exhausted = { ...entry, allocation: [...entry.allocation] as [...typeof entry.allocation] };
      exhausted.allocation[1] = BigInt(0);
      expect(allocationAccess(exhausted, account, timestamp)).toMatchObject({ yours: true, canClaim: false, canPay: false });
    }
  });
  it("hides actions when the current allocation period or agent day is exhausted", () => {
    const period = { ...personal, allocation: [...personal.allocation] as [...typeof personal.allocation] };
    const date = new Date(Number(timestamp) * 1000);
    period.allocation[4] = BigInt(date.getUTCFullYear() * 12 + date.getUTCMonth() + 1);
    period.allocation[3] = period.allocation[2];
    expect(allocationAccess(period, recipient, timestamp).canClaim).toBe(false);
    expect(allocationAccess(period, recipient, timestamp + BigInt(32 * 86400)).canClaim).toBe(true);

    const daily = { ...agentBudget, mandate: [...agentBudget.mandate] as [...typeof agentBudget.mandate] };
    daily.mandate[7] = timestamp / BigInt(86400);
    daily.mandate[6] = daily.mandate[4];
    expect(allocationAccess(daily, agent, timestamp).canPay).toBe(false);
    expect(allocationAccess(daily, agent, timestamp + BigInt(86400)).canPay).toBe(true);
  });
  it("only offers a five-minute claim while a window has allowance", () => {
    const timed = { ...personal, allocation: [...personal.allocation] as [...typeof personal.allocation],
      schedule: [timestamp, timestamp + BigInt(300), 60] as const };
    timed.allocation[5] = 3;
    expect(allocationAccess(timed, recipient, timestamp).canClaim).toBe(true);
    timed.allocation[4] = BigInt(1);
    timed.allocation[3] = timed.allocation[2];
    expect(allocationAccess(timed, recipient, timestamp).canClaim).toBe(false);
    expect(allocationAccess(timed, recipient, timestamp + BigInt(60)).canClaim).toBe(true);
    expect(allocationAccess(timed, recipient, timestamp + BigInt(300)).canClaim).toBe(false);
  });
  it("compares wallet addresses without case sensitivity", () => {
    const entry = { ...personal, allocation: [...personal.allocation] as [...typeof personal.allocation] };
    entry.allocation[0] = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    expect(allocationAccess(entry, entry.allocation[0].toUpperCase(), timestamp).canClaim).toBe(true);
  });
});
