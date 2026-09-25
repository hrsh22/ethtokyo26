import { AccordApi } from "@accord/api-contract";
import { ensPermissionAdapterAbi, spaceAccountAbi } from "@accord/chain";
import { HttpApiBuilder, HttpApiError } from "@effect/platform";
import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { getAddress, isAddress, zeroAddress, type Hex } from "viem";
import { currentSession, requireBrowserOrigin } from "./auth";
import { publicClient } from "./chain";
import { Database } from "./db";
import { databaseOperation } from "./db/run";
import { researchQuotes, spaceDrafts } from "./db/schema";
import { matchesResearchPayment } from "./research-receipt";

const title = "Agent spending report";
export const ResearchLive = HttpApiBuilder.group(AccordApi, "research", (handlers) => handlers
  .handle("quote", ({ payload }) => Effect.gen(function* () {
    yield* requireBrowserOrigin();
    const session = yield* currentSession();
    const db = yield* Database;
    const seller = process.env.RESEARCH_SELLER_ADDRESS;
    const token = process.env.DEMO_TOKEN_ADDRESS;
    const price = process.env.RESEARCH_PRICE_BASE_UNITS ?? "1000000000000000000";
    if (!seller || !isAddress(seller) || seller === zeroAddress || !token || !isAddress(token) ||
      !/^[1-9][0-9]*$/.test(price) || BigInt(price) >= 1n << 256n) return yield* Effect.fail(new HttpApiError.ServiceUnavailable());
    const [draft] = yield* databaseOperation(() => db.client.select().from(spaceDrafts).where(eq(spaceDrafts.id, payload.draftId)).limit(1));
    if (!draft?.activatedAt || !draft.spaceAddress || draft.tokenAddress?.toLowerCase() !== token.toLowerCase()) return yield* Effect.fail(new HttpApiError.BadRequest());
    const quote = { id: randomUUID(), actor: session.address, draftId: draft.id, allocationId: payload.allocationId,
      spaceAddress: getAddress(draft.spaceAddress), tokenAddress: getAddress(token), recipient: getAddress(seller),
      amount: price, expiresAt: new Date(Date.now() + 10 * 60_000) };
    yield* databaseOperation(() => db.client.insert(researchQuotes).values(quote));
    return { ...quote, title, expiresAt: quote.expiresAt.toISOString() };
  }))
  .handle("redeem", ({ payload }) => Effect.gen(function* () {
    yield* requireBrowserOrigin();
    const session = yield* currentSession();
    const db = yield* Database;
    const [quote] = yield* databaseOperation(() => db.client.select().from(researchQuotes).where(and(
      eq(researchQuotes.id, payload.quoteId), eq(researchQuotes.actor, session.address))).limit(1));
    if (!quote || (quote.transactionHash && quote.transactionHash.toLowerCase() !== payload.transactionHash.toLowerCase())) return yield* Effect.fail(new HttpApiError.Forbidden());
    const report = yield* Effect.tryPromise({ try: async () => {
      if (await publicClient.getChainId() !== 11155111) throw new Error("Wrong chain");
      const receipt = await publicClient.getTransactionReceipt({ hash: payload.transactionHash as Hex });
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
      if (receipt.blockHash !== block.hash || block.timestamp > BigInt(Math.floor(quote.expiresAt.getTime() / 1000)) ||
        !matchesResearchPayment(receipt, quote)) throw new Error("No matching confirmed payment");
      const address = getAddress(quote.spaceAddress);
      const args = [BigInt(quote.allocationId)] as const;
      const [allocation, mandate, adapter] = await Promise.all([
        publicClient.readContract({ address, abi: spaceAccountAbi, functionName: "allocations", args, blockNumber: block.number }),
        publicClient.readContract({ address, abi: spaceAccountAbi, functionName: "mandates", args, blockNumber: block.number }),
        publicClient.readContract({ address, abi: spaceAccountAbi, functionName: "ensAdapter", blockNumber: block.number }),
      ]);
      const ensAuthorized = await publicClient.readContract({ address: adapter, abi: ensPermissionAdapterAbi,
        functionName: "isAuthorized", args: [mandate[1], mandate[2], mandate[3], mandate[0]], blockNumber: block.number });
      const spent = mandate[7] === block.timestamp / 86400n ? mandate[6] : 0n;
      return { title, quoteId: quote.id, transactionHash: payload.transactionHash, spaceAddress: address,
        tokenAddress: getAddress(quote.tokenAddress), allocationId: quote.allocationId,
        blockNumber: block.number.toString(), generatedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
        remaining: allocation[1].toString(), dailyRemaining: (mandate[4] > spent ? mandate[4] - spent : 0n).toString(),
        maxPerPayment: mandate[5].toString(), agent: mandate[0],
        mandateActive: mandate[9] && mandate[8] > block.timestamp && !allocation[6], ensAuthorized,
        mandateExpiry: new Date(Number(mandate[8]) * 1000).toISOString() };
    }, catch: () => new HttpApiError.Forbidden() });
    // Retries return the same report snapshot without issuing another payment.
    yield* databaseOperation(() => db.client.update(researchQuotes).set({ transactionHash: payload.transactionHash.toLowerCase() })
      .where(and(eq(researchQuotes.id, quote.id), isNull(researchQuotes.transactionHash))));
    const [saved] = yield* databaseOperation(() => db.client.select().from(researchQuotes).where(eq(researchQuotes.id, quote.id)).limit(1));
    if (saved?.transactionHash !== payload.transactionHash.toLowerCase()) return yield* Effect.fail(new HttpApiError.Forbidden());
    return report;
  })));
