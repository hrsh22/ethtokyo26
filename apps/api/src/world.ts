import { AccordApi } from "@accord/api-contract";
import { HttpApiBuilder, HttpApiError } from "@effect/platform";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { currentSession, requireBrowserOrigin } from "./auth";
import { Database } from "./db";
import { databaseOperation } from "./db/run";
import { permitIntents, worldChallenges, worldProofs, worldSessions } from "./db/schema";

const environment = process.env.WORLD_ENVIRONMENT === "production" ? "production" : "staging";
const appId = process.env.WORLD_APP_ID;
const rpId = process.env.WORLD_RP_ID;
const signingKey = process.env.WORLD_RP_SIGNING_KEY;

type SessionResult = {
  protocol_version: "4.0";
  nonce: string;
  session_id: string;
  environment: string;
  user_presence_completed?: boolean;
  responses: Array<{
    identifier: string;
    issuer_schema_id: number;
    session_nullifier: string[];
    signal_hash?: string;
  }>;
};

export function parseSessionResult(value: unknown): SessionResult | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  if (result.protocol_version !== "4.0" ||
    typeof result.nonce !== "string" ||
    typeof result.session_id !== "string" ||
    !/^session_[a-fA-F0-9]{128}$/.test(result.session_id) ||
    typeof result.environment !== "string" ||
    "action" in result ||
    !Array.isArray(result.responses) || result.responses.length !== 1) return null;
  const responses = result.responses as unknown[];
  if (!responses.every((item) => item && typeof item === "object")) return null;
  return value as SessionResult;
}

function normalizedHex(value: string) {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) return null;
  return BigInt(value).toString(10);
}

function configured() {
  return !!appId?.startsWith("app_") && !!rpId?.startsWith("rp_") && !!signingKey;
}

async function verifyWithWorld(result: unknown) {
  const response = await fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Accord/0.1" },
    body: JSON.stringify(result),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  return response.json() as Promise<unknown>;
}

export function acceptedVerification(value: unknown, sessionId: string) {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  if (result.success !== true || result.environment !== environment || result.session_id !== sessionId) return false;
  if (!Array.isArray(result.results) || result.results.length !== 1) return false;
  return result.results.every((item) => {
    if (!item || typeof item !== "object") return false;
    const credential = item as Record<string, unknown>;
    return credential.identifier === "selfie" && credential.success === true;
  });
}

export const WorldLive = HttpApiBuilder.group(AccordApi, "world", (handlers) =>
  handlers
    .handle("status", () => Effect.gen(function* () {
      const session = yield* currentSession();
      const db = yield* Database;
      const rows = yield* databaseOperation(() => db.client.select().from(worldSessions)
        .where(eq(worldSessions.address, session.address)).limit(1));
      return { configured: configured(), enrolled: rows.length > 0, environment,
        ...(rows[0] ? { sessionId: rows[0].sessionId } : {}) };
    }))
    .handle("challenge", ({ payload }) => Effect.gen(function* () {
      yield* requireBrowserOrigin();
      const session = yield* currentSession();
      if (!configured()) return yield* Effect.fail(new HttpApiError.ServiceUnavailable());
      const db = yield* Database;
      const rows = yield* databaseOperation(() => db.client.select().from(worldSessions)
        .where(eq(worldSessions.address, session.address)).limit(1));
      const existing = rows[0];
      if ((payload.mode === "enroll" && existing) || (payload.mode !== "enroll" && !existing) ||
        (payload.mode === "claim" && !payload.intentId) ||
        (payload.mode !== "claim" && payload.intentId)) {
        return yield* Effect.fail(new HttpApiError.Forbidden());
      }
      let signal = `accord:wallet:${session.address}`;
      if (payload.mode === "claim") {
        const intents = yield* databaseOperation(() => db.client.select().from(permitIntents)
          .where(and(eq(permitIntents.id, payload.intentId!), eq(permitIntents.actor, session.address),
            eq(permitIntents.action, "claim"), isNull(permitIntents.signature),
            gt(permitIntents.expiry, new Date()))).limit(1));
        if (!intents[0]) return yield* Effect.fail(new HttpApiError.Forbidden());
        signal = intents[0].permitDigest;
      }
      const rpSignature = yield* Effect.try({
        try: () => signRequest({ signingKeyHex: signingKey!, ttl: 300 }),
        catch: () => new HttpApiError.ServiceUnavailable(),
      });
      const id = randomUUID();
      yield* databaseOperation(() => db.client.insert(worldChallenges).values({
        id, address: session.address, mode: payload.mode,
        ...(payload.intentId ? { intentId: payload.intentId } : {}),
        signalHash: hashSignal(signal),
        nonce: rpSignature.nonce.toLowerCase(),
        expiresAt: new Date(rpSignature.expiresAt * 1000),
      }));
      return {
        id, appId: appId!, environment,
        ...(existing ? { sessionId: existing.sessionId } : {}),
        requireUserPresence: payload.mode !== "enroll",
        signal,
        rpContext: {
          rp_id: rpId!, nonce: rpSignature.nonce,
          created_at: rpSignature.createdAt, expires_at: rpSignature.expiresAt,
          signature: rpSignature.sig,
        },
      };
    }))
    .handle("verify", ({ payload }) => Effect.gen(function* () {
      yield* requireBrowserOrigin();
      const session = yield* currentSession();
      if (!configured()) return yield* Effect.fail(new HttpApiError.ServiceUnavailable());
      const proof = parseSessionResult(payload.result);
      if (!proof || proof.environment !== environment) return yield* Effect.fail(new HttpApiError.Unauthorized());
      const selfie = proof.responses.find((item) => item.identifier === "selfie" && item.issuer_schema_id === 11);
      if (!selfie || !Array.isArray(selfie.session_nullifier) || selfie.session_nullifier.length !== 2) {
        return yield* Effect.fail(new HttpApiError.Unauthorized());
      }
      const nullifier = normalizedHex(selfie.session_nullifier[0]!);
      const action = normalizedHex(selfie.session_nullifier[1]!);
      if (!nullifier || !action) return yield* Effect.fail(new HttpApiError.Unauthorized());
      const db = yield* Database;
      const challenges = yield* databaseOperation(() => db.client.select().from(worldChallenges)
        .where(and(eq(worldChallenges.id, payload.id), eq(worldChallenges.address, session.address),
          eq(worldChallenges.nonce, proof.nonce.toLowerCase()),
          isNull(worldChallenges.consumedAt), gt(worldChallenges.expiresAt, new Date())))
        .limit(1));
      const challenge = challenges[0];
      if (!challenge) return yield* Effect.fail(new HttpApiError.Unauthorized());
      const mode = challenge.mode;
      if ((mode === "reverify" || mode === "claim") && proof.user_presence_completed !== true) {
        return yield* Effect.fail(new HttpApiError.Unauthorized());
      }
      if (!challenge.signalHash || !selfie.signal_hash ||
        normalizedHex(challenge.signalHash) !== normalizedHex(selfie.signal_hash)) {
        return yield* Effect.fail(new HttpApiError.Unauthorized());
      }
      const existingRows = yield* databaseOperation(() => db.client.select().from(worldSessions)
        .where(eq(worldSessions.address, session.address)).limit(1));
      const existing = existingRows[0];
      if ((mode === "enroll" && existing) ||
        ((mode === "reverify" || mode === "claim") && (!existing || existing.sessionId !== proof.session_id))) {
        return yield* Effect.fail(new HttpApiError.Forbidden());
      }
      if (mode === "claim") {
        const intents = yield* databaseOperation(() => db.client.select().from(permitIntents)
          .where(and(eq(permitIntents.id, challenge.intentId!), eq(permitIntents.actor, session.address),
            eq(permitIntents.action, "claim"), isNull(permitIntents.signature),
            gt(permitIntents.expiry, new Date()))).limit(1));
        if (!intents[0] || hashSignal(intents[0].permitDigest) !== challenge.signalHash) {
          return yield* Effect.fail(new HttpApiError.Forbidden());
        }
      }
      const verified = yield* Effect.tryPromise({
        try: () => verifyWithWorld(payload.result),
        catch: () => new HttpApiError.ServiceUnavailable(),
      });
      if (!acceptedVerification(verified, proof.session_id)) {
        return yield* Effect.fail(new HttpApiError.Unauthorized());
      }
      const recorded = yield* Effect.tryPromise({
        try: () => db.client.transaction(async (tx) => {
          const consumed = await tx.update(worldChallenges).set({ consumedAt: new Date() })
            .where(and(eq(worldChallenges.id, challenge.id), isNull(worldChallenges.consumedAt),
              gt(worldChallenges.expiresAt, new Date()))).returning({ id: worldChallenges.id });
          if (consumed.length !== 1) throw new Error("Challenge replay");
          const proofRows = await tx.insert(worldProofs).values({
            id: randomUUID(), sessionId: proof.session_id, nullifier, action,
            ...(challenge.intentId ? { intentId: challenge.intentId } : {}),
          }).onConflictDoNothing().returning({ id: worldProofs.id });
          if (proofRows.length !== 1) throw new Error("Proof replay");
          if (mode === "enroll") {
            const enrolled = await tx.insert(worldSessions)
              .values({ address: session.address, sessionId: proof.session_id })
              .onConflictDoNothing().returning({ address: worldSessions.address });
            if (enrolled.length !== 1) throw new Error("Session already linked");
          }
          if (mode === "claim") {
            const approved = await tx.update(permitIntents).set({ worldVerifiedAt: new Date() })
              .where(and(eq(permitIntents.id, challenge.intentId!), eq(permitIntents.actor, session.address),
                eq(permitIntents.action, "claim"), isNull(permitIntents.worldVerifiedAt),
                isNull(permitIntents.signature), gt(permitIntents.expiry, new Date())))
              .returning({ id: permitIntents.id });
            if (approved.length !== 1) throw new Error("Intent already approved or expired");
          }
          return true;
        }),
        catch: () => new HttpApiError.Unauthorized(),
      });
      if (!recorded) return yield* Effect.fail(new HttpApiError.Unauthorized());
      return { verified: true as const, enrolled: true, sessionId: proof.session_id,
        ...(challenge.intentId ? { intentId: challenge.intentId } : {}) };
    })),
);
