import { describe, expect, it } from "vitest";
import { spaceAccountAbi } from "@accord/chain";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, keccak256, toBytes, type Address, type TransactionReceipt } from "viem";
import { matchesResearchPayment, type PurchaseTerms } from "./research-receipt";

const actor = `0x${"11".repeat(20)}` as Address;
const space = `0x${"22".repeat(20)}` as Address;
const token = `0x${"33".repeat(20)}` as Address;
const seller = `0x${"44".repeat(20)}` as Address;
const quote: PurchaseTerms = { id: "purchase-a", actor, spaceAddress: space, tokenAddress: token, recipient: seller, allocationId: "2", amount: "5" };
const base = { blockHash: `0x${"00".repeat(32)}`, blockNumber: 1n, transactionHash: `0x${"aa".repeat(32)}`, transactionIndex: 0, logIndex: 0, removed: false };
const paid = { ...base, address: space,
  topics: encodeEventTopics({ abi: spaceAccountAbi, eventName: "PaymentMade", args: { requestId: keccak256(toBytes(quote.id)), allocationId: 2n, agent: actor } }),
  data: encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [seller, 5n]),
} as TransactionReceipt["logs"][number];
const transfer = { ...base, address: token,
  topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: space, to: seller } }),
  data: encodeAbiParameters([{ type: "uint256" }], [5n]),
} as TransactionReceipt["logs"][number];
const receipt = { status: "success" as const, logs: [paid, transfer] };

describe("paid report receipt binding", () => {
  it("requires both the exact Space purchase and token transfer", () => {
    expect(matchesResearchPayment(receipt, quote)).toBe(true);
    expect(matchesResearchPayment({ ...receipt, logs: [paid] }, quote)).toBe(false);
    expect(matchesResearchPayment({ ...receipt, logs: [transfer] }, quote)).toBe(false);
    expect(matchesResearchPayment({ ...receipt, status: "reverted" }, quote)).toBe(false);
  });
  it.each([
    ["id", "purchase-b"], ["actor", seller], ["spaceAddress", actor],
    ["tokenAddress", actor], ["recipient", actor], ["allocationId", "1"], ["amount", "4"],
  ])("rejects mismatched %s", (key, value) => {
    expect(matchesResearchPayment(receipt, { ...quote, [key!]: value })).toBe(false);
  });
});
