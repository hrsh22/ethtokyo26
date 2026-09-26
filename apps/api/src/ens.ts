import { AccordApi } from "@accord/api-contract";
import { HttpApiBuilder, HttpApiError } from "@effect/platform";
import { Effect } from "effect";
import { getAddress, isAddress, zeroAddress } from "viem";
import { ensRegistryAbi } from "./ens-v2";
import { labelhash, normalize } from "viem/ens";
import { publicClient } from "./chain";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Database } from "./db";
import { databaseOperation } from "./db/run";
import { allocationNames } from "./db/schema";
import { publicSpaceRead } from "./demo-space";
import { confirmedRecipientLabel, normalizeRecipientName, resolveRecipientName } from "./ens-recipient";

const registryAbi = [{
  type: "function", name: "getState", stateMutability: "view",
  inputs: [{ name: "anyId", type: "uint256" }],
  outputs: [{ name: "state", type: "tuple", components: [
    { name: "status", type: "uint8" }, { name: "expiry", type: "uint64" },
    { name: "latestOwner", type: "address" }, { name: "tokenId", type: "uint256" },
    { name: "resource", type: "uint256" },
  ] }],
}] as const;

export const EnsLive = HttpApiBuilder.group(AccordApi, "ens", (handlers) =>
  handlers.handle("resolve", ({ payload }) => Effect.gen(function* () {
    let name: string;
    try { name = normalize(payload.name.trim()); }
    catch { return yield* Effect.fail(new HttpApiError.BadRequest()); }
    const labels = name.split(".");
    if (labels.length < 2 || labels.length > 8 || labels.at(-1) !== "eth" || !labels[0]) {
      return yield* Effect.fail(new HttpApiError.BadRequest());
    }
    const configured = process.env.ENSV2_REGISTRY_ADDRESS;
    if (!configured || !isAddress(configured)) return yield* Effect.fail(new HttpApiError.ServiceUnavailable());
    let registry = getAddress(configured);
    for (const label of labels.slice(1, -1).reverse()) {
      const parent = yield* Effect.tryPromise({
        try: () => publicClient.readContract({ address: registry, abi: ensRegistryAbi, functionName: "getState", args: [BigInt(labelhash(label))] }),
        catch: () => new HttpApiError.ServiceUnavailable(),
      });
      if (parent.status !== 2 || parent.expiry <= BigInt(Math.floor(Date.now()/1000))) return yield* Effect.fail(new HttpApiError.NotFound());
      registry = yield* Effect.tryPromise({
        try: () => publicClient.readContract({ address: registry, abi: ensRegistryAbi, functionName: "getSubregistry", args: [label] }),
        catch: () => new HttpApiError.ServiceUnavailable(),
      });
      if (registry === zeroAddress) return yield* Effect.fail(new HttpApiError.NotFound());
    }
    const nameId = BigInt(labelhash(labels[0]!));
    const state = yield* Effect.tryPromise({
      try: () => publicClient.readContract({ address: registry, abi: registryAbi, functionName: "getState", args: [nameId] }),
      catch: () => new HttpApiError.ServiceUnavailable(),
    });
    return {
      name, registry, nameId: nameId.toString(),
      resource: state.resource.toString(), owner: getAddress(state.latestOwner),
      expiry: state.expiry.toString(),
      active: state.status === 2 && state.expiry > BigInt(Math.floor(Date.now() / 1000)) &&
        state.latestOwner !== zeroAddress && state.resource > 0n,
    };
  }))
  .handle("recipient", ({ payload }) => Effect.gen(function* () {
    let name: string;
    try { name = normalizeRecipientName(payload.name); }
    catch { return yield* Effect.fail(new HttpApiError.BadRequest()); }
    const resolved = yield* Effect.tryPromise({
      try: () => resolveRecipientName(name), catch: () => new HttpApiError.ServiceUnavailable(),
    });
    if (!resolved) return yield* Effect.fail(new HttpApiError.NotFound());
    return resolved;
  }))
  .handle("allocationNames", ({ payload }) => Effect.gen(function* () {
    if (payload.allocationIds.length === 0) return { names: [] };
    const db = yield* Database;
    const { rows } = yield* databaseOperation(() => publicSpaceRead(db, payload.spaceAddress, (client) => client.select().from(allocationNames)
      .where(and(eq(allocationNames.spaceAddress, getAddress(payload.spaceAddress)),
        inArray(allocationNames.allocationId, [...payload.allocationIds])))
      .orderBy(desc(allocationNames.createdAt)).limit(100)));
    if (rows.length === 0) return { names: [] };
    return yield* Effect.tryPromise({ try: async () => {
      const block = await publicClient.getBlockNumber({ cacheTime: 0 });
      const confirmed = await Promise.all(rows.map(async (row) =>
        await confirmedRecipientLabel(row, block) ? row : null));
      const seen = new Set<string>();
      return { names: confirmed.flatMap((row) => {
        if (!row || seen.has(row.allocationId)) return [];
        seen.add(row.allocationId);
        return [{ allocationId: row.allocationId, name: row.name, address: row.beneficiary, resolvedBlock: row.resolvedBlock }];
      }) };
    }, catch: () => new HttpApiError.ServiceUnavailable() });
  })),
);
