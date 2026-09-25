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
  return { isAgent, recipient, yours, closed, funded, mandateActive,
    canClaim: yours && !isAgent && !closed && funded,
    canPay: yours && isAgent && !closed && funded && mandateActive };
}
