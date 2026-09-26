import { AccordApi, ToolkitError } from "@accord/api-contract";
import { spaceAccountAbi } from "@accord/chain";
import { HttpApiBuilder, HttpApiError } from "@effect/platform";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { randomBytes, randomUUID } from "node:crypto";
import { getAddress, keccak256, toBytes, type Hex } from "viem";
import { agentName, connectionIdentity, resolveAgent, toolkitError } from "./agent-connection";
import { currentSession, requireBrowserOrigin, tokenHash } from "./auth";
import { Database, type DatabaseClient } from "./db";
import { agentConnections, agentPairings, agentPolicies, agentRequests, agentSubmissions, researchQuotes, spaceDrafts } from "./db/schema";
import { publicClient } from "./chain";
import { requestStatus } from "./approval-state";
import { matchesResearchPayment } from "./research-receipt";
import { repositoryName, repositoryReport } from "./repository-research";
import { serial } from "./serial";

const attempt = <A>(work: () => Promise<A>) => Effect.tryPromise({ try: work, catch: error => error instanceof ToolkitError
  ? error : toolkitError("service_unavailable", "The agent service is temporarily unavailable. Resume the same operation when it recovers.") });
const connectionView = (c: typeof agentConnections.$inferSelect) => ({ id: c.id, name: c.name, agent: getAddress(c.agent),
  spaceAddress: getAddress(c.spaceAddress), allocationId: c.allocationId, createdAt: c.createdAt.toISOString(),
  expiresAt: c.expiresAt.toISOString(), lastSeenAt: c.lastSeenAt?.toISOString() ?? null, revoked: !!c.revokedAt });
const pairingView = (p: typeof agentPairings.$inferSelect) => ({ id: p.id, agent: getAddress(p.agent), name: p.name,
  expiresAt: p.expiresAt.toISOString(), connectionId: p.connectionId });
function connected() {
  return Effect.gen(function* () {
    const session = yield* currentSession();
    if (!session.connection) return yield* Effect.fail(new HttpApiError.Forbidden());
    return session.connection;
  });
}
async function pairing(db: DatabaseClient, id: string, secret: string, mode: "review" | "poll") {
  const [row] = await db.select().from(agentPairings).where(and(eq(agentPairings.id, id),
    eq(mode === "review" ? agentPairings.reviewHash : agentPairings.pollHash, tokenHash(secret)), gt(agentPairings.expiresAt, new Date())));
  if (!row) throw toolkitError("pairing_expired", "This connection link is invalid or expired. Start a new connection from your terminal.");
  return row;
}
type QuoteRow = typeof researchQuotes.$inferSelect;
type QuoteTerms = { tier: "snapshot" | "comparison"; repositories: string[]; criteria: string[]; agentName: string; collectedAt: string; blockNumber: string };
function quoteView(q: QuoteRow) {
  const terms = JSON.parse(q.terms!) as QuoteTerms;
  return { id: q.id, operationKey: q.operationKey!, service: q.service,
    title: terms.tier === "snapshot" ? "Repository snapshot" : "Repository comparison evidence", ...terms,
    draftId: q.draftId, allocationId: q.allocationId, spaceAddress: getAddress(q.spaceAddress), tokenAddress: getAddress(q.tokenAddress),
    recipient: getAddress(q.recipient), amount: q.amount, expiresAt: q.expiresAt.toISOString() };
}
async function ownedQuote(db: DatabaseClient, id: string, c: typeof agentConnections.$inferSelect) {
  const [row] = await db.select().from(researchQuotes).where(and(eq(researchQuotes.id, id), eq(researchQuotes.connectionId, c.id),
    eq(researchQuotes.actor, c.agent), eq(researchQuotes.draftId, c.draftId), eq(researchQuotes.allocationId, c.allocationId)));
  if (!row?.terms || row.service !== "repository-research") throw toolkitError("operation_not_found", "This operation does not belong to the connected agent.");
  return row;
}
async function paymentReceipt(q: QuoteRow, hash: Hex) {
  const receipt = await publicClient.getTransactionReceipt({ hash });
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  if (receipt.blockHash !== block.hash || block.timestamp > BigInt(Math.floor(q.expiresAt.getTime() / 1000)) || !matchesResearchPayment(receipt, q)) {
    throw toolkitError("receipt_mismatch", "The transaction does not contain this quote's exact successful payment.");
  }
  return receipt;
}
async function operationView(db: DatabaseClient, q: QuoteRow, withResult = false) {
  const requestId = keccak256(toBytes(q.id));
  const [submission] = await db.select().from(agentSubmissions).where(eq(agentSubmissions.requestId, requestId));
  const [approval] = await db.select().from(agentRequests).where(and(eq(agentRequests.actor, q.actor), eq(agentRequests.requestKey, q.id)));
  let transactionHash = q.transactionHash ?? submission?.transactionHash ?? null;
  let status = q.expiresAt <= new Date() ? "expired" : "quoted";
  if (approval) {
    const state = requestStatus(approval);
    status = ["pending", "verified"].includes(state) ? "awaiting_approval" : ["approved", "issued"].includes(state) ? "ready" : state;
  }
  if (q.expiresAt <= new Date() && ["quoted", "awaiting_approval", "ready"].includes(status)) status = "expired";
  if (!transactionHash) {
    // Also recovers the narrow crash window between broadcast and saving its hash.
    const consumed = await publicClient.readContract({ address: getAddress(q.spaceAddress), abi: spaceAccountAbi,
      functionName: "consumedRequests", args: [requestId] });
    if (consumed) {
      const start = BigInt((JSON.parse(q.terms!) as QuoteTerms).blockNumber), end = await publicClient.getBlockNumber();
      // A quote lasts ten minutes. Bound the scan even when viewing an old quote.
      const toBlock = end < start + 300n ? end : start + 300n;
      const events = await publicClient.getContractEvents({ address: getAddress(q.spaceAddress), abi: spaceAccountAbi,
        eventName: "PaymentMade", args: { requestId }, fromBlock: start, toBlock });
      transactionHash = events[0]?.transactionHash ?? null;
      if (!transactionHash) status = "reconciling"; // Never repay a consumed request.
    }
  }
  if (transactionHash) {
    try {
      await paymentReceipt(q, transactionHash as Hex);
      status = q.transactionHash ? "delivered" : "confirmed";
    } catch (error) {
      if (error instanceof ToolkitError) throw error;
      status = "submitted";
    }
  }
  return { quote: quoteView(q), status, transactionHash, approvalId: approval?.id ?? null,
    reviewUrl: approval ? new URL(`/approvals/${approval.id}`, process.env.WEB_ORIGIN ?? "http://localhost:3000").toString() : null,
    ...(withResult && status === "delivered" && q.result ? { result: JSON.parse(q.result) as unknown } : {}) };
}

export const ToolkitLive = HttpApiBuilder.group(AccordApi, "toolkit", handlers => handlers
  .handle("resolve", ({ payload }) => Effect.gen(function* () {
    const db = yield* Database;
    return yield* attempt(async () => ({ identities: await resolveAgent(db.client, payload.name) }));
  }))
  .handle("pair", ({ payload }) => Effect.gen(function* () {
    yield* requireBrowserOrigin(); const session = yield* currentSession(), db = yield* Database;
    if (session.kind !== "agent_setup") return yield* Effect.fail(new HttpApiError.Forbidden());
    return yield* attempt(() => serial(`pair:${session.address}`, async () => {
      const recent = await db.client.select().from(agentPairings).where(and(eq(agentPairings.agent, session.address),
        gt(agentPairings.createdAt, new Date(Date.now() - 60_000))));
      if (recent.length >= 3) throw toolkitError("rate_limited", "Wait a minute before starting another connection.");
      const id = randomUUID(), reviewToken = randomBytes(32).toString("hex"), pollToken = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 30 * 60_000);
      await db.client.insert(agentPairings).values({ id, agent: session.address, name: payload.name ? agentName(payload.name) : null,
        reviewHash: tokenHash(reviewToken), pollHash: tokenHash(pollToken), expiresAt });
      const url = new URL(`/connect/${id}`, process.env.WEB_ORIGIN ?? "http://localhost:3000");
      url.hash = reviewToken; // Not sent in navigation logs or the Referer header.
      return { id, reviewUrl: url.toString(), pollToken, expiresAt: expiresAt.toISOString() };
    }));
  }))
  .handle("review", ({ payload }) => Effect.gen(function* () {
    yield* requireBrowserOrigin(); yield* currentSession(); const db = yield* Database;
    return yield* attempt(async () => pairingView(await pairing(db.client, payload.id, payload.reviewToken, "review")));
  }))
  .handle("accept", ({ payload }) => Effect.gen(function* () {
    yield* requireBrowserOrigin(); const session = yield* currentSession(), db = yield* Database;
    return yield* attempt(() => serial(`pairing:${payload.id}`, async () => {
      const row = await pairing(db.client, payload.id, payload.reviewToken, "review");
      if (row.acceptedAt) throw toolkitError("pairing_used", "This connection was already accepted.");
      const [draft] = await db.client.select().from(spaceDrafts).where(and(eq(spaceDrafts.id, payload.draftId), eq(spaceDrafts.owner, session.address)));
      if (!draft?.spaceAddress) throw toolkitError("wrong_owner", "Choose a Space you own.");
      const policies = await db.client.select().from(agentPolicies).where(and(eq(agentPolicies.spaceAddress, draft.spaceAddress),
        eq(agentPolicies.allocationId, payload.allocationId))).orderBy(desc(agentPolicies.createdAt));
      const selected = policies.find(p => p.agent.toLowerCase() === row.agent && (!row.name || p.name === row.name));
      if (!selected) throw toolkitError("signer_mismatch", "Give this agent's signer a budget in this Space first.");
      const identities = await resolveAgent(db.client, selected.name);
      const identity = identities.find(i => i.draftId === draft.id && i.allocationId === payload.allocationId);
      if (!identity?.active || identity.agent.toLowerCase() !== row.agent || identity.owner.toLowerCase() !== session.address) {
        throw toolkitError("identity_changed", "The active delegation must match this signer and Space owner.");
      }
      return db.client.transaction(async tx => {
        const id = randomUUID();
        const used = await tx.update(agentPairings).set({ acceptedAt: new Date(), connectionId: id, name: identity.name }).where(and(
          eq(agentPairings.id, row.id), isNull(agentPairings.acceptedAt), gt(agentPairings.expiresAt, new Date()))).returning();
        if (!used.length) throw toolkitError("pairing_used", "This connection link was already used or expired.");
        const [connection] = await tx.insert(agentConnections).values({ id, agent: row.agent, owner: session.address,
          draftId: draft.id, spaceAddress: identity.spaceAddress, allocationId: identity.allocationId, name: identity.name,
          registry: identity.registry, nameId: identity.nameId, resource: identity.resource, expiresAt: new Date(Date.now() + 30 * 86400_000) }).returning();
        return connectionView(connection!);
      });
    }));
  }))
  .handle("poll", ({ payload }) => Effect.gen(function* () {
    const session = yield* currentSession(), db = yield* Database;
    return yield* attempt(async () => {
      const row = await pairing(db.client, payload.id, payload.pollToken, "poll");
      if (row.agent !== session.address) throw toolkitError("wrong_signer", "This connection belongs to another signer.");
      return pairingView(row);
    });
  }))
  .handle("identity", () => Effect.gen(function* () {
    const c = yield* connected(), db = yield* Database;
    return yield* attempt(() => connectionIdentity(db.client, c));
  }))
  .handle("connections", ({ payload }) => Effect.gen(function* () {
    const session = yield* currentSession(), db = yield* Database;
    return yield* attempt(async () => {
      const rows = await db.client.select().from(agentConnections).where(and(eq(agentConnections.owner, session.address),
        eq(agentConnections.draftId, payload.draftId), eq(agentConnections.allocationId, payload.allocationId))).orderBy(desc(agentConnections.createdAt));
      return { connections: rows.map(connectionView) };
    });
  }))
  .handle("disconnect", ({ payload }) => Effect.gen(function* () {
    yield* requireBrowserOrigin(); const session = yield* currentSession(), db = yield* Database;
    if (session.connection && session.connection.id !== payload.id) return yield* Effect.fail(new HttpApiError.Forbidden());
    return yield* attempt(async () => {
      const [row] = await db.client.update(agentConnections).set({ revokedAt: new Date() }).where(and(eq(agentConnections.id, payload.id),
        session.connection ? eq(agentConnections.agent, session.address) : eq(agentConnections.owner, session.address))).returning();
      if (!row) throw toolkitError("connection_not_found", "This connection was not found.");
      return { disconnected: true };
    });
  }))
  .handle("services", () => Effect.gen(function* () {
    yield* connected();
    return { services: [
      { id: "repository-research:snapshot", title: "Repository snapshot", tier: "snapshot" as const, amount: "1000000",
        description: "Accord example merchant: release, license and activity sources for up to three public GitHub repositories. Test tUSDC." },
      { id: "repository-research:comparison", title: "Repository comparison evidence", tier: "comparison" as const, amount: "20000000",
        description: "90-day commit coverage, up to ten releases and README evidence for up to three criteria, with sources and gaps. Test tUSDC." },
    ] };
  }))
  .handle("quote", ({ payload }) => Effect.gen(function* () {
    const c = yield* connected(), db = yield* Database;
    return yield* attempt(() => serial(`quote:${c.id}:${payload.operationKey}`, async () => {
      const repositories = [...new Set(payload.repositories.map(repositoryName))];
      const criteria = payload.criteria.map(s => s.trim()).filter(Boolean);
      const [existing] = await db.client.select().from(researchQuotes).where(and(eq(researchQuotes.connectionId, c.id), eq(researchQuotes.operationKey, payload.operationKey)));
      if (existing) {
        const terms = JSON.parse(existing.terms!) as QuoteTerms;
        if (JSON.stringify([terms.repositories, terms.tier, terms.criteria]) !== JSON.stringify([repositories, payload.tier, criteria])) {
          throw toolkitError("quote_mismatch", "This operation key already belongs to different research terms.");
        }
        return quoteView(existing);
      }
      const identity = await connectionIdentity(db.client, c);
      const seller = process.env.RESEARCH_SELLER_ADDRESS;
      if (!seller) throw toolkitError("service_unavailable", "The example merchant is not configured.");
      const recent = await db.client.select({ id: researchQuotes.id }).from(researchQuotes).where(and(
        eq(researchQuotes.connectionId, c.id), gt(researchQuotes.createdAt, new Date(Date.now() - 60_000))));
      if (recent.length >= 3) throw toolkitError("rate_limited", "Wait a minute before requesting another research quote.");
      const amount = payload.tier === "snapshot" ? "1000000" : "20000000";
      if (BigInt(amount) > BigInt(identity.remaining) || BigInt(amount) > BigInt(identity.dailyRemaining) || BigInt(amount) > BigInt(identity.maxPerPayment)) {
        throw toolkitError("budget_exceeded", "This report exceeds the agent's current available budget or payment limits.");
      }
      const result = await repositoryReport(repositories, payload.tier, criteria);
      const [q] = await db.client.insert(researchQuotes).values({ id: randomUUID(), actor: c.agent, connectionId: c.id, operationKey: payload.operationKey,
        draftId: c.draftId, allocationId: c.allocationId, spaceAddress: c.spaceAddress, tokenAddress: identity.tokenAddress,
        recipient: getAddress(seller), amount, expiresAt: new Date(Date.now() + 10 * 60_000), service: "repository-research",
        terms: JSON.stringify({ tier: payload.tier, repositories, criteria, agentName: c.name, collectedAt: result.collectedAt, blockNumber: identity.blockNumber }),
        result: JSON.stringify(result) }).returning();
      return quoteView(q!);
    }));
  }))
  .handle("operations", () => Effect.gen(function* () {
    const c = yield* connected(), db = yield* Database;
    return yield* attempt(async () => {
      const rows = await db.client.select().from(researchQuotes).where(eq(researchQuotes.connectionId, c.id)).orderBy(desc(researchQuotes.createdAt)).limit(20);
      const operations = [];
      for (const row of rows) operations.push(await operationView(db.client, row));
      return { operations };
    });
  }))
  .handle("operation", ({ payload }) => Effect.gen(function* () {
    const c = yield* connected(), db = yield* Database;
    return yield* attempt(async () => operationView(db.client, await ownedQuote(db.client, payload.id, c), true));
  }))
  .handle("redeem", ({ payload }) => Effect.gen(function* () {
    const c = yield* connected(), db = yield* Database;
    return yield* attempt(() => serial(`redeem:${payload.id}`, async () => {
      const q = await ownedQuote(db.client, payload.id, c);
      if (q.transactionHash && q.transactionHash.toLowerCase() !== payload.transactionHash.toLowerCase()) throw toolkitError("receipt_mismatch", "This report was already delivered for a different transaction.");
      await paymentReceipt(q, payload.transactionHash as Hex);
      await db.client.update(researchQuotes).set({ transactionHash: payload.transactionHash.toLowerCase() }).where(eq(researchQuotes.id, q.id));
      return operationView(db.client, { ...q, transactionHash: payload.transactionHash.toLowerCase() }, true);
    }));
  })));
