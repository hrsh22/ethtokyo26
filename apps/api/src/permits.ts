import { AccordApi, DecisionRejected, ScreeningUnavailable } from "@accord/api-contract";
import { allocationWindow, ensPermissionAdapterAbi, hashSpacePermit, PermitAction, signSpacePermit, spaceAccountAbi, type SpacePermit } from "@accord/chain";
import { HttpApiBuilder, HttpApiError } from "@effect/platform";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { randomBytes, randomUUID } from "node:crypto";
import { getAddress, isAddress, keccak256, toBytes, zeroHash, type Address, type Hex } from "viem";
import { currentSession, requireBrowserOrigin } from "./auth";
import { adapterAddress, permitSigner, publicClient } from "./chain";
import { Database } from "./db";
import { databaseOperation } from "./db/run";
import { permitIntents, researchQuotes, spaceDrafts } from "./db/schema";
import { screenRecipient } from "./risk";

type IntentRow = typeof permitIntents.$inferSelect;
type Kind = "claim" | "pay";

function fromRow(row: IntentRow): SpacePermit {
  return {
    actor: getAddress(row.actor),
    action: row.action === "claim" ? PermitAction.Claim : PermitAction.Pay,
    allocationId: BigInt(row.allocationId),
    recipient: getAddress(row.recipient),
    amount: BigInt(row.amount),
    requestId: row.requestId as Hex,
    nonce: BigInt(row.nonce),
    expiry: BigInt(Math.floor(row.expiry.getTime() / 1000)),
    policyVersion: BigInt(row.policyVersion),
    detailsHash: zeroHash,
  };
}

function response(row: IntentRow) {
  const permit = fromRow(row);
  return {
    id: row.id,
    spaceAddress: getAddress(row.spaceAddress),
    digest: row.permitDigest,
    permit: {
      actor: permit.actor,
      action: permit.action as 2 | 3,
      allocationId: permit.allocationId.toString(),
      recipient: permit.recipient,
      amount: permit.amount.toString(),
      requestId: permit.requestId,
      nonce: permit.nonce.toString(),
      expiry: permit.expiry.toString(),
      policyVersion: permit.policyVersion.toString(),
      detailsHash: permit.detailsHash,
    },
    ...(row.signature ? { signature: row.signature } : {}),
    worldVerified: !!row.worldVerifiedAt,
    ...(row.signature && row.action === "pay" ? { riskVerdict: "allow" as const,
      decision: { outcome: "allow" as const, code: "screening_passed",
        reason: "ENS authority and spending limits passed. Intercepta reported zero toxic score and no risk traits.",
        checkedAt: row.riskCheckedAt!.toISOString(), toxicScore: Number(row.riskScore), traits: [] as string[] },
    } : {}),
  };
}

async function trustedSpace(space: Address, token: Address, owner: Address) {
  const signer = permitSigner();
  const adapter = adapterAddress();
  const [onchainOwner, authorizer, onchainToken, onchainAdapter, policyVersion, code] = await Promise.all([
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "owner" }),
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "authorizer" }),
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "token" }),
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "ensAdapter" }),
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "policyVersion" }),
    publicClient.getBytecode({ address: space }),
  ]);
  if (!code || onchainOwner.toLowerCase() !== owner.toLowerCase() ||
    authorizer.toLowerCase() !== signer.address.toLowerCase() ||
    onchainToken.toLowerCase() !== token.toLowerCase() ||
    onchainAdapter.toLowerCase() !== adapter.toLowerCase()) throw new Error("Untrusted Space");
  return policyVersion;
}

function denied(code: string, reason: string) {
  return new DecisionRejected({ decision: { outcome: "block", code, reason,
    checkedAt: new Date().toISOString(), traits: [] } });
}

async function liveActionState(kind: Kind, space: Address, allocationId: bigint, actor: Address, amount: bigint, recipient: Address) {
  const block = await publicClient.getBlock();
  const [allocation, policyVersion] = await Promise.all([
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "allocations", args: [allocationId], blockNumber: block.number }),
    publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "policyVersion", blockNumber: block.number }),
  ]);
  if (allocationId === 0n || allocation[6]) throw denied("allocation_closed", "This allocation is closed or unavailable.");
  const schedule = allocation[5] === 3 ? await publicClient.readContract({
    address: space, abi: spaceAccountAbi, functionName: "allocationSchedules", args: [allocationId], blockNumber: block.number,
  }) : undefined;
  const window = allocationWindow(allocation, block.timestamp, schedule);
  if (window.expired) throw denied("allocation_expired", "This allocation's claim window has ended. Its owner can recover the unclaimed funds.");
  if (amount === 0n || amount > allocation[1]) throw denied("insufficient_allocation", "The requested amount exceeds this allocation's remaining funds.");
  if (allocation[5] !== 0) {
    if (amount > window.available) throw denied("allocation_period_cap", allocation[5] === 3
      ? "This window's allowance is used up or too small for this claim. Reduce the amount or wait for the next reset; unused allowance does not carry over."
      : "This amount exceeds the allocation's remaining period allowance. Reduce the amount or wait for the next period.");
  }
  if (kind === "claim") {
    if (allocation[0].toLowerCase() !== actor.toLowerCase() || recipient.toLowerCase() !== actor.toLowerCase()) {
      throw denied("wrong_beneficiary", "Only the named beneficiary can claim this allocation.");
    }
  } else {
    if (allocation[0].toLowerCase() !== "0x0000000000000000000000000000000000000000") throw denied("not_agent_budget", "This allocation is reserved for a person, not agent payments.");
    const mandate = await publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "mandates", args: [allocationId], blockNumber: block.number });
    if (!mandate[9]) throw denied("mandate_inactive", "The mandate is missing or revoked. Its owner must grant a new mandate before the agent can pay.");
    if (mandate[0].toLowerCase() !== actor.toLowerCase()) throw denied("wrong_agent", "Connect the wallet named in this agent mandate.");
    if (mandate[8] <= block.timestamp) throw denied("mandate_expired", "The agent mandate has expired.");
    if (amount > mandate[5]) throw denied("payment_cap", "This amount exceeds the mandate's per-payment limit.");
    if (recipient.toLowerCase() === "0x0000000000000000000000000000000000000000") throw denied("invalid_recipient", "A payment needs a valid recipient.");
    const spent = mandate[7] === block.timestamp / 86400n ? mandate[6] : 0n;
    if (spent + amount > mandate[4]) throw denied("daily_cap", "This payment would exceed the agent's daily spending limit. Try a smaller amount or wait until the next UTC day.");
    const allowed = await publicClient.readContract({
      address: adapterAddress(), abi: ensPermissionAdapterAbi, functionName: "isAuthorized",
      args: [mandate[1], mandate[2], mandate[3], actor], blockNumber: block.number,
    });
    if (!allowed) throw denied("ens_authority_changed", "The agent no longer holds the required ENSv2 authority. The name may have expired, transferred, or changed registration.");
  }
  return policyVersion;
}

function parseAmount(value: string) {
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed >= 1n << 256n) throw new Error("Invalid amount or allocation");
  return parsed;
}

async function simulate(kind: Kind, row: IntentRow, signature: Hex) {
  const permit = fromRow(row);
  const address = getAddress(row.spaceAddress);
  await publicClient.simulateContract(kind === "claim" ? {
    address, abi: spaceAccountAbi, functionName: "claim",
    args: [permit.allocationId, permit.amount, permit, signature],
    account: permit.actor,
  } : {
    address, abi: spaceAccountAbi, functionName: "pay",
    args: [permit.allocationId, permit.recipient, permit.amount, permit, signature],
    account: permit.actor,
  });
}

export const PermitsLive = HttpApiBuilder.group(AccordApi, "permits", (handlers) =>
  handlers
    .handle("prepareClaim", ({ payload }) => Effect.gen(function* () {
      yield* requireBrowserOrigin();
      const session = yield* currentSession();
      const actor = getAddress(session.address);
      if (payload.recipient && payload.recipient.toLowerCase() !== actor.toLowerCase()) {
        return yield* Effect.fail(new HttpApiError.BadRequest());
      }
      const row = yield* prepareIntent("claim", payload, actor);
      return response(row);
    }))
    .handle("signClaim", ({ payload }) => Effect.gen(function* () {
      yield* requireBrowserOrigin();
      const session = yield* currentSession();
      const db = yield* Database;
      const rows = yield* databaseOperation(() => db.client.select().from(permitIntents).where(and(
        eq(permitIntents.id, payload.intentId), eq(permitIntents.actor, session.address),
        eq(permitIntents.action, "claim"))).limit(1));
      const row = rows[0];
      if (!row || !row.worldVerifiedAt) return yield* Effect.fail(new HttpApiError.Forbidden());
      return yield* signIntent(row);
    }))
    .handle("authorizePayment", ({ payload }) => Effect.gen(function* () {
      yield* requireBrowserOrigin();
      const session = yield* currentSession();
      if (!payload.recipient || !isAddress(payload.recipient)) return yield* Effect.fail(new HttpApiError.BadRequest());
      const actor = getAddress(session.address);
      const row = yield* prepareIntent("pay", payload, actor);
      if (row.signature) return yield* reusableSignedIntent(row);
      const db = yield* Database;
      const screened = yield* Effect.tryPromise({
        try: () => screenRecipient(row.recipient),
        catch: () => new ScreeningUnavailable({ decision: { outcome: "unavailable", code: "screening_unavailable",
          reason: "Intercepta screening is unavailable. Payment is paused; no signature was issued. Try again once screening is available.",
          checkedAt: new Date().toISOString(), traits: [] } }),
      });
      yield* databaseOperation(() => db.client.update(permitIntents).set({
        riskScore: screened.toxicScore.toString(),
        riskTraits: JSON.stringify(screened.traits),
        riskCheckedAt: new Date(screened.checkedAt),
      }).where(eq(permitIntents.id, row.id)));
      if (screened.verdict !== "allow") return yield* Effect.fail(new DecisionRejected({ decision: {
        outcome: "block", code: "recipient_risk", checkedAt: screened.checkedAt, toxicScore: screened.toxicScore,
        traits: screened.traits.map((trait) => trait.name),
        reason: `Intercepta reported toxic score ${screened.toxicScore}${screened.traits.length ? ` and risk traits: ${screened.traits.map((trait) => trait.name.replaceAll("_", " ")).join(", ")}` : ""}. Accord requires zero score and no reported traits; no payment signature was issued.`,
      } }));
      const current = yield* databaseOperation(() => db.client.select().from(permitIntents)
        .where(eq(permitIntents.id, row.id)).limit(1));
      return yield* signIntent(current[0]!);
    })),
);

function prepareIntent(kind: Kind, payload: {
  draftId: string; allocationId: string; amount: string; requestKey: string; recipient?: string;
}, actor: Address) {
  return Effect.gen(function* () {
    const db = yield* Database;
    const existing = yield* databaseOperation(() => db.client.select().from(permitIntents).where(and(
      eq(permitIntents.actor, actor.toLowerCase()), eq(permitIntents.requestKey, payload.requestKey))).limit(1));
    if (existing.length) {
      const row = existing[0]!;
      if (row.action !== kind || row.draftId !== payload.draftId ||
        row.allocationId !== payload.allocationId || row.amount !== payload.amount ||
        row.recipient.toLowerCase() !== (payload.recipient ?? actor).toLowerCase()) {
        return yield* Effect.fail(new HttpApiError.BadRequest());
      }
      return row;
    }
    const drafts = yield* databaseOperation(() => db.client.select().from(spaceDrafts)
      .where(eq(spaceDrafts.id, payload.draftId)).limit(1));
    const draft = drafts[0];
    if (!draft?.spaceAddress || !draft.tokenAddress || !draft.activatedAt) {
      return yield* Effect.fail(new HttpApiError.Forbidden());
    }
    let allocationId: bigint, amount: bigint;
    try { allocationId = parseAmount(payload.allocationId); amount = parseAmount(payload.amount); }
    catch { return yield* Effect.fail(new HttpApiError.BadRequest()); }
    const space = getAddress(draft.spaceAddress);
    const recipient = getAddress(payload.recipient ?? actor);
    const policyVersion = yield* Effect.tryPromise({
      try: async () => {
        await trustedSpace(space, getAddress(draft.tokenAddress!), getAddress(draft.owner));
        return liveActionState(kind, space, allocationId, actor, amount, recipient);
      },
      catch: (error) => error instanceof DecisionRejected ? error : new HttpApiError.Forbidden(),
    });
    let expiry = new Date(Date.now() + (kind === "pay" ? 2 * 60_000 : 10 * 60_000));
    const [quote] = yield* databaseOperation(() => db.client.select().from(researchQuotes)
      .where(eq(researchQuotes.id, payload.requestKey)).limit(1));
    if (quote) {
      if (kind !== "pay" || quote.actor !== actor.toLowerCase() || quote.draftId !== payload.draftId ||
        quote.allocationId !== payload.allocationId || quote.amount !== payload.amount ||
        quote.recipient.toLowerCase() !== recipient.toLowerCase()) return yield* Effect.fail(new HttpApiError.BadRequest());
      if (quote.expiresAt <= new Date()) return yield* Effect.fail(denied("quote_expired", "The report quote has expired. Request a new quote before paying."));
      expiry = new Date(Math.min(expiry.getTime(), quote.expiresAt.getTime()));
    }
    const permit: SpacePermit = {
      actor, action: kind === "claim" ? PermitAction.Claim : PermitAction.Pay,
      allocationId, recipient, amount,
      requestId: keccak256(toBytes(payload.requestKey)),
      nonce: BigInt(`0x${randomBytes(32).toString("hex")}`),
      expiry: BigInt(Math.floor(expiry.getTime() / 1000)),
      policyVersion, detailsHash: zeroHash,
    };
    const row = {
      id: randomUUID(), requestKey: payload.requestKey, draftId: draft.id,
      spaceAddress: space, actor: actor.toLowerCase(), action: kind,
      allocationId: allocationId.toString(), recipient,
      amount: amount.toString(), requestId: permit.requestId,
      nonce: permit.nonce.toString(), expiry,
      policyVersion: permit.policyVersion.toString(),
      permitDigest: hashSpacePermit(space, permit),
    };
    const inserted = yield* databaseOperation(() => db.client.insert(permitIntents).values(row)
      .onConflictDoNothing().returning());
    if (inserted.length === 1) return inserted[0]!;
    const concurrent = yield* databaseOperation(() => db.client.select().from(permitIntents)
      .where(and(eq(permitIntents.actor, actor.toLowerCase()), eq(permitIntents.requestKey, payload.requestKey))).limit(1));
    if (!concurrent.length) return yield* Effect.fail(new HttpApiError.Forbidden());
    if (concurrent[0]!.action !== kind || concurrent[0]!.draftId !== payload.draftId ||
      concurrent[0]!.allocationId !== payload.allocationId || concurrent[0]!.amount !== payload.amount ||
      concurrent[0]!.recipient.toLowerCase() !== recipient.toLowerCase()) {
      return yield* Effect.fail(new HttpApiError.BadRequest());
    }
    return concurrent[0]!;
  });
}

function signIntent(row: IntentRow) {
  return Effect.gen(function* () {
    if (row.signature) return yield* reusableSignedIntent(row);
    if (row.expiry <= new Date()) return yield* Effect.fail(denied("permission_expired", "This permission has expired. Start a fresh request before asking your wallet to pay."));
    if (row.action === "claim" && !row.worldVerifiedAt) return yield* Effect.fail(new HttpApiError.Forbidden());
    if (row.action === "pay" && (!row.riskCheckedAt || row.riskScore !== "0" || row.riskTraits !== "[]" ||
      Date.now() - row.riskCheckedAt.getTime() > 60_000)) return yield* Effect.fail(new HttpApiError.Forbidden());
    const db = yield* Database;
    const draftRows = yield* databaseOperation(() => db.client.select().from(spaceDrafts)
      .where(eq(spaceDrafts.id, row.draftId)).limit(1));
    const draft = draftRows[0];
    if (!draft?.spaceAddress || !draft.tokenAddress) return yield* Effect.fail(new HttpApiError.Forbidden());
    const permit = fromRow(row);
    const signature = yield* Effect.tryPromise({
      try: async () => {
        const policy = await trustedSpace(getAddress(row.spaceAddress), getAddress(draft.tokenAddress!), getAddress(draft.owner));
        const livePolicy = await liveActionState(row.action as Kind, getAddress(row.spaceAddress),
          permit.allocationId, permit.actor, permit.amount, permit.recipient);
        if (policy !== permit.policyVersion || livePolicy !== permit.policyVersion ||
          hashSpacePermit(getAddress(row.spaceAddress), permit) !== row.permitDigest) throw new Error("Stale permit");
        const sig = await signSpacePermit(permitSigner(), getAddress(row.spaceAddress), permit);
        await simulate(row.action as Kind, row, sig);
        return sig;
      },
      catch: (error) => error instanceof DecisionRejected ? error : new HttpApiError.Forbidden(),
    });
    const saved = yield* databaseOperation(() => db.client.update(permitIntents)
      .set({ signature, signedAt: new Date() })
      .where(and(eq(permitIntents.id, row.id), isNull(permitIntents.signature), gt(permitIntents.expiry, new Date()),
        ...(row.action === "claim" ? [isNotNull(permitIntents.worldVerifiedAt)] : [isNotNull(permitIntents.riskCheckedAt)])))
      .returning());
    if (saved.length === 1) return response(saved[0]!);
    const concurrent = yield* databaseOperation(() => db.client.select().from(permitIntents)
      .where(eq(permitIntents.id, row.id)).limit(1));
    if (!concurrent[0]?.signature) return yield* Effect.fail(new HttpApiError.Forbidden());
    return response(concurrent[0]);
  });
}

function reusableSignedIntent(row: IntentRow) {
  return Effect.tryPromise({ try: async () => {
    const space = getAddress(row.spaceAddress);
    const [consumedRequest, consumedNonce] = await Promise.all([
      publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "consumedRequests", args: [row.requestId as Hex] }),
      publicClient.readContract({ address: space, abi: spaceAccountAbi, functionName: "consumedNonces", args: [getAddress(row.actor), BigInt(row.nonce)] }),
    ]);
    if (consumedRequest || consumedNonce) throw denied("request_completed", "This payment or claim was already executed. Use its receipt to retrieve the result; do not pay again.");
    if (row.expiry <= new Date()) throw denied("permission_expired", "This permission has expired. Start a fresh request; the old signature cannot be used.");
    await liveActionState(row.action as Kind, space, BigInt(row.allocationId), getAddress(row.actor), BigInt(row.amount), getAddress(row.recipient));
    await simulate(row.action as Kind, row, row.signature as Hex);
    return response(row);
  }, catch: (error) => error instanceof DecisionRejected ? error : new HttpApiError.Forbidden() });
}
