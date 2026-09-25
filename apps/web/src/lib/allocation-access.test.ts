import { describe, expect, it } from "vitest";
import { allocationAccess } from "./allocation-access";
import { agent, agentBudget, owner, personal, recipient, timestamp } from "../../test/space-fixtures";

describe("allocation actions by wallet role", () => {
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
  it("compares wallet addresses without case sensitivity", () => {
    const entry = { ...personal, allocation: [...personal.allocation] as [...typeof personal.allocation] };
    entry.allocation[0] = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    expect(allocationAccess(entry, entry.allocation[0].toUpperCase(), timestamp).canClaim).toBe(true);
  });
});
