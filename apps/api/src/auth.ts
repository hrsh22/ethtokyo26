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
import { authChallenges, sessions } from "./db/schema";
import { databaseOperation } from "./db/run";

const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
// Cookies are shared across ports on the same host. The isolated browser harness
// uses its own name so a test login cannot replace the normal app's session.
const sessionCookieName = process.env.ACCORD_SESSION_COOKIE_NAME ?? "accord_session";
const sessionCookie = HttpApiSecurity.apiKey({ in: "cookie", key: sessionCookieName });
const sessionDurationMs = 24 * 60 * 60 * 1000;

function tokenHash(token: string) {
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
    return session;
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
