import { zeroAddress } from "viem";
import type { SpaceAllocation } from "./use-space-terms";

/** UI affordances only. The API and contract still authorize every action. */
export function allocationAccess(entry: SpaceAllocation, account: string, timestamp: bigint) {
  const { allocation, mandate, ensAuthorized } = entry;
  const isAgent = allocation[0] === zeroAddress;
  const recipient = isAgent ? mandate[0] : allocation[0];
  const yours = account.toLowerCase() !== zeroAddress && recipient.toLowerCase() === account.toLowerCase();
  const closed = allocation[6];
  const funded = allocation[1] > BigInt(0);
  const mandateActive = mandate[9] && mandate[8] > timestamp && ensAuthorized;
  const period = allocation[5];
  const currentPeriod = period === 1 ? timestamp / BigInt(86400) + BigInt(1)
    : period === 2 ? (() => {
      const date = new Date(Number(timestamp) * 1000);
      return BigInt(date.getUTCFullYear() * 12 + date.getUTCMonth() + 1);
    })() : BigInt(0);
  const spentInPeriod = allocation[4] === currentPeriod ? allocation[3] : BigInt(0);
  const periodAvailable = period === 0 || spentInPeriod < allocation[2];
  const today = timestamp / BigInt(86400);
  const spentToday = mandate[7] === today ? mandate[6] : BigInt(0);
  const mandateAvailable = spentToday < mandate[4];
  return { isAgent, recipient, yours, closed, funded, mandateActive,
    canClaim: yours && !isAgent && !closed && funded && periodAvailable,
    canPay: yours && isAgent && !closed && funded && periodAvailable && mandateActive && mandateAvailable };
}
