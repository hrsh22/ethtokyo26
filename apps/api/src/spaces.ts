import { AccordApi } from "@accord/api-contract";
import { HttpApiBuilder, HttpApiError } from "@effect/platform";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { type Hex } from "viem";
import { getAddress } from "viem";
import { currentSession, requireBrowserOrigin } from "./auth";
import { deployedSpaceFromReceipt } from "./chain";
import { Database } from "./db";
import { databaseOperation } from "./db/run";
import { spaceDrafts } from "./db/schema";
import { listReceivedAllocations } from "./received-allocations";

function draftResponse(row: typeof spaceDrafts.$inferSelect) {
  return {
    id: row.id, name: row.name,
    templateId: row.templateId as "recurring-support" | "research-budget",
    owner: row.owner, createdAt: row.createdAt.toISOString(),
    ...(row.spaceAddress && row.tokenAddress && row.activatedAt ? {
      spaceAddress: row.spaceAddress, tokenAddress: row.tokenAddress,
      activatedAt: row.activatedAt.toISOString(),
    } : {}),
  };
}

export const SpacesLive = HttpApiBuilder.group(AccordApi, "spaces", (handlers) =>
  handlers
    .handle("list", () =>
      Effect.gen(function* () {
        const session = yield* currentSession();
        const db = yield* Database;
        const rows = yield* databaseOperation(() =>
          db.client
            .select()
            .from(spaceDrafts)
            .where(eq(spaceDrafts.owner, session.address))
            .orderBy(desc(spaceDrafts.createdAt)),
        );
        return {
          spaces: rows.map(draftResponse),
        };
      }),
    )
    .handle("received", () => Effect.gen(function* () {
      const session = yield* currentSession();
      const db = yield* Database;
      const allowances = yield* Effect.tryPromise({
        try: () => listReceivedAllocations(db.client, session.address),
        catch: () => new HttpApiError.ServiceUnavailable(),
      });
      return { allowances };
    }))
    .handle("createDraft", ({ payload }) =>
      Effect.gen(function* () {
        yield* requireBrowserOrigin();
        const session = yield* currentSession();
        const name = payload.name.trim();
        if (name.length < 2) return yield* Effect.fail(new HttpApiError.BadRequest());
        const db = yield* Database;
        const id = randomUUID();
        const createdAt = new Date();
        yield* databaseOperation(() =>
          db.client.insert(spaceDrafts).values({
            id,
            name,
            templateId: payload.templateId,
            owner: session.address,
            createdAt,
          }),
        );
        return {
          id,
          name,
          templateId: payload.templateId,
          owner: session.address,
          createdAt: createdAt.toISOString(),
        };
      }),
    )
    .handle("activate", ({ payload }) => Effect.gen(function* () {
      yield* requireBrowserOrigin();
      const session = yield* currentSession();
      const db = yield* Database;
      const rows = yield* databaseOperation(() => db.client.select().from(spaceDrafts)
        .where(and(eq(spaceDrafts.id, payload.draftId), eq(spaceDrafts.owner, session.address))).limit(1));
      const draft = rows[0];
      if (!draft) return yield* Effect.fail(new HttpApiError.Forbidden());
      const deploymentTx = payload.deploymentTx.toLowerCase();
      if (draft.spaceAddress) {
        if (draft.deploymentTx !== deploymentTx || !draft.tokenAddress || !draft.activatedAt) {
          return yield* Effect.fail(new HttpApiError.Forbidden());
        }
        return draftResponse(draft);
      }
      const deployment = yield* Effect.tryPromise({
        try: () => deployedSpaceFromReceipt(payload.deploymentTx as Hex, session.address as `0x${string}`),
        catch: () => new HttpApiError.BadRequest(),
      });
      const activatedAt = new Date();
      const updated = yield* databaseOperation(() => db.client.update(spaceDrafts).set({
        spaceAddress: deployment.space,
        tokenAddress: deployment.token,
        deploymentTx,
        deploymentBlock: deployment.blockNumber.toString(),
        activatedAt,
      }).where(and(eq(spaceDrafts.id, draft.id), eq(spaceDrafts.owner, session.address),
        isNull(spaceDrafts.spaceAddress))).returning());
      if (updated[0]) return draftResponse(updated[0]);
      // Two retries may race after the same receipt confirms. Return the first
      // completed write only when it belongs to this owner and transaction.
      const completed = yield* databaseOperation(() => db.client.select().from(spaceDrafts)
        .where(and(eq(spaceDrafts.id, draft.id), eq(spaceDrafts.owner, session.address),
          eq(spaceDrafts.deploymentTx, deploymentTx))).limit(1));
      if (!completed[0]?.spaceAddress || !completed[0].tokenAddress || !completed[0].activatedAt) {
        return yield* Effect.fail(new HttpApiError.Forbidden());
      }
      return draftResponse(completed[0]);
    }))
    .handle("profile", ({ payload }) => Effect.gen(function* () {
      const db = yield* Database;
      const rows = yield* databaseOperation(() => db.client.select({ name: spaceDrafts.name, spaceAddress: spaceDrafts.spaceAddress })
        .from(spaceDrafts).where(and(eq(spaceDrafts.spaceAddress, getAddress(payload.spaceAddress)), isNotNull(spaceDrafts.activatedAt))).limit(1));
      const row = rows[0];
      if (!row?.spaceAddress) return yield* Effect.fail(new HttpApiError.NotFound());
      return { name: row.name, spaceAddress: getAddress(row.spaceAddress) };
    }))
    .handle("lookup", ({ payload }) => Effect.gen(function* () {
      yield* currentSession();
      const db = yield* Database;
      const rows = yield* databaseOperation(() => db.client.select().from(spaceDrafts)
        .where(eq(spaceDrafts.spaceAddress, getAddress(payload.spaceAddress))).limit(1));
      const row = rows[0];
      if (!row?.spaceAddress || !row.tokenAddress || !row.activatedAt) {
        return yield* Effect.fail(new HttpApiError.NotFound());
      }
      return {
        id: row.id,
        name: row.name,
        templateId: row.templateId as "recurring-support" | "research-budget",
        owner: row.owner,
        createdAt: row.createdAt.toISOString(),
        spaceAddress: getAddress(row.spaceAddress),
        tokenAddress: getAddress(row.tokenAddress),
        activatedAt: row.activatedAt.toISOString(),
      };
    })),
);
