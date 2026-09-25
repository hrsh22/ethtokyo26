import { spaceAccountAbi } from "@accord/chain";
import { decodeEventLog, erc20Abi, keccak256, toBytes, type TransactionReceipt } from "viem";

export type PurchaseTerms = {
  id: string; actor: string; allocationId: string; spaceAddress: string;
  tokenAddress: string; recipient: string; amount: string;
};

/** A transfer alone is not payment for this purchase: the exact Space request must match. */
export function matchesResearchPayment(receipt: Pick<TransactionReceipt, "status" | "logs">, quote: PurchaseTerms): boolean {
  if (receipt.status !== "success") return false;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const requestId = keccak256(toBytes(quote.id));
  const paid = receipt.logs.some((log) => {
    if (!same(log.address, quote.spaceAddress)) return false;
    try {
      const { args } = decodeEventLog({ abi: spaceAccountAbi, eventName: "PaymentMade", data: log.data, topics: log.topics });
      return args.requestId === requestId && args.allocationId === BigInt(quote.allocationId) &&
        same(args.agent, quote.actor) && same(args.recipient, quote.recipient) && args.amount === BigInt(quote.amount);
    } catch { return false; }
  });
  const transferred = receipt.logs.some((log) => {
    if (!same(log.address, quote.tokenAddress)) return false;
    try {
      const { args } = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data, topics: log.topics });
      return same(args.from, quote.spaceAddress) && same(args.to, quote.recipient) && args.value === BigInt(quote.amount);
    } catch { return false; }
  });
  return paid && transferred;
}
