import { allocationWindow } from "@accord/chain";
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
  const periodAvailable = allocation[5] !== 3 || entry.schedule !== undefined
    ? allocationWindow(allocation, timestamp, entry.schedule).available > BigInt(0) : false;
  const today = timestamp / BigInt(86400);
  const spentToday = mandate[7] === today ? mandate[6] : BigInt(0);
  const mandateAvailable = spentToday < mandate[4];
  return { isAgent, recipient, yours, closed, funded, mandateActive,
    canClaim: yours && !isAgent && !closed && funded && periodAvailable,
    canPay: yours && isAgent && !closed && funded && periodAvailable && mandateActive && mandateAvailable };
}
