import { AccordApi } from "@accord/api-contract";
import {
  HttpApiBuilder,
  HttpApiError,
  HttpApiSecurity,
  HttpServerRequest,
} from "@effect/platform";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getAddress, verifyMessage } from "viem";
import { createSiweMessage } from "viem/siwe";
import { Database } from "./db";
import { agentConnections, authChallenges, sessions } from "./db/schema";
import { databaseOperation } from "./db/run";

const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
// Cookies are shared across ports on the same host. The isolated browser harness
// uses its own name so a test login cannot replace the normal app's session.
const sessionCookieName = process.env.ACCORD_SESSION_COOKIE_NAME ?? "accord_session";
const sessionCookie = HttpApiSecurity.apiKey({ in: "cookie", key: sessionCookieName });
const sessionDurationMs = 24 * 60 * 60 * 1000;

export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function requireBrowserOrigin() {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const origin = request.headers.origin;
    if (origin && origin !== webOrigin) {
      return yield* Effect.fail(new HttpApiError.Forbidden());
    }
  });
}

export function currentSession() {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const db = yield* Database;
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : request.cookies[sessionCookieName];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      return yield* Effect.fail(new HttpApiError.Unauthorized());
    }
    const rows = yield* databaseOperation(() =>
      db.client
        .select()
        .from(sessions)
        .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date())))
        .limit(1),
    );
    const session = rows[0];
    if (!session) return yield* Effect.fail(new HttpApiError.Unauthorized());
    let connection: typeof agentConnections.$inferSelect | undefined;
    const path = new URL(request.url, "http://localhost").pathname;
    if (session.kind === "agent_setup") {
      if (!["/v1/auth/session", "/v1/toolkit/pair", "/v1/toolkit/pair/poll"].includes(path)) {
        return yield* Effect.fail(new HttpApiError.Forbidden());
      }
    } else if (session.kind === "agent") {
      if (!session.connectionId) return yield* Effect.fail(new HttpApiError.Unauthorized());
      [connection] = yield* databaseOperation(() => db.client.select().from(agentConnections).where(and(
        eq(agentConnections.id, session.connectionId!), eq(agentConnections.agent, session.address),
        isNull(agentConnections.revokedAt), gt(agentConnections.expiresAt, new Date()),
      )).limit(1));
      if (!connection) return yield* Effect.fail(new HttpApiError.Unauthorized());
      // Deny new endpoints by default. Payload-level scope is checked by the
      // payment, relay, approval-read and toolkit handlers below this gate.
      if (!["/v1/auth/session", "/v1/toolkit/identity", "/v1/toolkit/disconnect", "/v1/toolkit/services",
        "/v1/toolkit/quotes", "/v1/toolkit/operations", "/v1/toolkit/operation", "/v1/toolkit/redeem",
        "/v1/permits/payments", "/v1/sponsor/relay", "/v1/approvals/get"].includes(path)) {
        return yield* Effect.fail(new HttpApiError.Forbidden());
      }
      if (!connection.lastSeenAt || Date.now() - connection.lastSeenAt.getTime() > 60_000) {
        yield* databaseOperation(() => db.client.update(agentConnections).set({ lastSeenAt: new Date() })
          .where(eq(agentConnections.id, connection!.id)));
      }
    } else if (session.kind !== "browser") return yield* Effect.fail(new HttpApiError.Unauthorized());
    return { ...session, connection };
  });
}

export type Session = Effect.Effect.Success<ReturnType<typeof currentSession>>;
export function assertAgentScope(session: Session, target: { draftId?: string; allocationId?: string; spaceAddress?: string }) {
  return Effect.gen(function* () {
    if (session.kind === "browser") return;
    const c = session.connection;
    if (!c || (target.draftId && c.draftId !== target.draftId) ||
      (target.allocationId && c.allocationId !== target.allocationId) ||
      (target.spaceAddress && c.spaceAddress.toLowerCase() !== target.spaceAddress.toLowerCase())) {
      return yield* Effect.fail(new HttpApiError.Forbidden());
    }
  });
}

export const AuthLive = HttpApiBuilder.group(AccordApi, "auth", (handlers) =>
  handlers
    .handle("challenge", ({ payload }) =>
      Effect.gen(function* () {
        yield* requireBrowserOrigin();
        const db = yield* Database;
        const id = randomUUID();
        const address = getAddress(payload.address);
        const issuedAt = new Date();
        const expiresAt = new Date(issuedAt.getTime() + 5 * 60 * 1000);
        const message = createSiweMessage({
          address,
          chainId: 11155111,
          domain: new URL(webOrigin).host,
          uri: webOrigin,
          version: "1",
          nonce: randomBytes(16).toString("hex"),
          issuedAt,
          expirationTime: expiresAt,
          statement: "Sign in to manage your Accord Spaces.",
        });
        yield* databaseOperation(() =>
          db.client.insert(authChallenges).values({
            id,
            address: address.toLowerCase(),
            message,
            expiresAt,
          }),
        );
        return { id, message, expiresAt: expiresAt.toISOString() };
      }),
    )
    .handle("verify", ({ payload }) =>
      Effect.gen(function* () {
        yield* requireBrowserOrigin();
        const db = yield* Database;
        const address = getAddress(payload.address);
        const rows = yield* databaseOperation(() =>
          db.client
            .select()
            .from(authChallenges)
            .where(
              and(
                eq(authChallenges.id, payload.id),
                eq(authChallenges.address, address.toLowerCase()),
                isNull(authChallenges.consumedAt),
                gt(authChallenges.expiresAt, new Date()),
              ),
            )
            .limit(1),
        );
        const challenge = rows[0];
        if (!challenge) return yield* Effect.fail(new HttpApiError.Unauthorized());
        const valid = yield* Effect.tryPromise({
          try: () =>
            verifyMessage({
              address,
              message: challenge.message,
              signature: payload.signature as `0x${string}`,
            }),
          catch: () => new HttpApiError.Unauthorized(),
        });
        if (!valid) return yield* Effect.fail(new HttpApiError.Unauthorized());

        if (payload.client === "agent" && payload.connectionId) {
          const [connection] = yield* databaseOperation(() => db.client.select().from(agentConnections).where(and(
            eq(agentConnections.id, payload.connectionId!), eq(agentConnections.agent, address.toLowerCase()),
            isNull(agentConnections.revokedAt), gt(agentConnections.expiresAt, new Date()),
          )).limit(1));
          if (!connection) return yield* Effect.fail(new HttpApiError.Forbidden());
        }

        const claimed = yield* databaseOperation(() =>
          db.client
            .update(authChallenges)
            .set({ consumedAt: new Date() })
            .where(and(eq(authChallenges.id, payload.id), isNull(authChallenges.consumedAt)))
            .returning({ id: authChallenges.id }),
        );
        if (claimed.length !== 1) return yield* Effect.fail(new HttpApiError.Unauthorized());

        const token = randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + sessionDurationMs);
        yield* databaseOperation(() =>
          db.client.insert(sessions).values({
            tokenHash: tokenHash(token),
            address: address.toLowerCase(),
            expiresAt,
            kind: payload.client === "browser" ? "browser" : payload.connectionId ? "agent" : "agent_setup",
            connectionId: payload.client === "agent" ? payload.connectionId ?? null : null,
          }),
        );
        if (payload.client === "browser") {
          yield* HttpApiBuilder.securitySetCookie(sessionCookie, token, {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: "24 hours",
          });
        }
        return {
          address,
          expiresAt: expiresAt.toISOString(),
          ...(payload.client === "agent" ? { token } : {}),
        };
      }),
    )
    .handle("session", () =>
      Effect.gen(function* () {
        const session = yield* currentSession();
        return { address: session.address, expiresAt: session.expiresAt.toISOString() };
      }),
    ),
);
