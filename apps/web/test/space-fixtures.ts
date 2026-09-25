import { zeroAddress, type Address } from "viem";
import type { SpaceAllocation } from "../src/lib/use-space-terms";

export const owner = "0x1111111111111111111111111111111111111111" as Address;
export const recipient = "0x2222222222222222222222222222222222222222" as Address;
export const agent = "0x3333333333333333333333333333333333333333" as Address;
export const space = "0x4444444444444444444444444444444444444444" as Address;
export const token = "0x5555555555555555555555555555555555555555" as Address;
export const timestamp = BigInt(1_800_000_000);
export function allocation(id: number, beneficiary: Address, remaining = 1200): SpaceAllocation {
  return { id: BigInt(id), allocation: [beneficiary, BigInt(remaining * 1e6), BigInt(200e6), BigInt(0), BigInt(0), 2, false],
    mandate: [zeroAddress, zeroAddress, BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), false], ensAuthorized: false, schedule: undefined };
}
export const personal = allocation(1, recipient);
export const agentBudget: SpaceAllocation = { ...allocation(2, zeroAddress, 500),
  mandate: [agent, token, BigInt(1), BigInt(1), BigInt(50e6), BigInt(10e6), BigInt(0), BigInt(0), timestamp + BigInt(86400 * 10), true], ensAuthorized: true };
export const allocations = [personal, agentBudget, allocation(3, owner, 300)];
