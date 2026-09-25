import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { HttpApiBuilder, HttpServer } from "@effect/platform";
import { Layer } from "effect";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getAddress, type Hex } from "viem";
import { ApiLive } from "./app";
import * as chain from "./chain";
import * as namespaces from "./namespaces";
import { Database } from "./db";
import { sessions, spaceDrafts } from "./db/schema";

const address = (n: string) => getAddress(`0x${n.repeat(40)}`);
const owner = address("1"), space = address("2"), token = address("3"), registry = address("4");
const bearer = "a".repeat(64), deploymentTx = `0x${"b".repeat(64)}` as Hex;
let connection: ReturnType<typeof createClient>, db: ReturnType<typeof drizzle>;
let api: ReturnType<typeof HttpApiBuilder.toWebHandler>, draftId: string;

beforeEach(async () => {
  draftId = randomUUID();
  vi.spyOn(chain, "deployedSpaceFromReceipt").mockResolvedValue({ space, token, blockNumber: 100n });
  vi.spyOn(namespaces, "provisionSpaceNamespace").mockResolvedValue({ registry, name: "savings-22222222.accordspaces26.eth" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  connection = createClient({ url: ":memory:" });
  db = drizzle(connection);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle-sqlite", import.meta.url)) });
  await db.insert(sessions).values({ tokenHash: createHash("sha256").update(bearer).digest("hex"),
    address: owner.toLowerCase(), expiresAt: new Date(Date.now() + 60_000) });
  await db.insert(spaceDrafts).values({ id: draftId, owner: owner.toLowerCase(), name: "Savings", templateId: "recurring-support" });
  api = HttpApiBuilder.toWebHandler(Layer.mergeAll(ApiLive.pipe(Layer.provide(Layer.succeed(Database, { client: db }))), HttpServer.layerContext));
});
afterEach(async () => { await api.dispose(); connection.close(); vi.restoreAllMocks(); });

function activate(id = draftId, tx = deploymentTx) {
  return api.handler(new Request("http://localhost/v1/spaces/activate", { method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify({ draftId: id, deploymentTx: tx }) }));
}

describe("Space ENS registration during setup", () => {
  it("registers the Space name without requiring an agent or World identity", async () => {
    const response = await activate();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: draftId, spaceAddress: space });
    expect(namespaces.provisionSpaceNamespace).toHaveBeenCalledWith(db, expect.objectContaining({ id: draftId, spaceAddress: space, owner: owner.toLowerCase() }));
    expect((await db.select().from(spaceDrafts))[0]?.activatedAt).toBeInstanceOf(Date);
  });

  it("keeps a failed registration resumable with the original deployment transaction", async () => {
    vi.mocked(namespaces.provisionSpaceNamespace).mockRejectedValueOnce(new Error("private RPC details"));
    const failed = await activate();
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private RPC");
    expect((await db.select().from(spaceDrafts))[0]).toMatchObject({ spaceAddress: null, activatedAt: null });
    expect((await activate()).status).toBe(200);
    expect(await db.select().from(spaceDrafts)).toHaveLength(1);
    expect(chain.deployedSpaceFromReceipt).toHaveBeenLastCalledWith(deploymentTx, owner.toLowerCase());
  });

  it("never provisions a name for an unowned draft or invalid deployment", async () => {
    expect((await activate(randomUUID())).status).toBe(403);
    vi.mocked(chain.deployedSpaceFromReceipt).mockRejectedValue(new Error("wrong deployment"));
    expect((await activate()).status).toBe(400);
    expect(namespaces.provisionSpaceNamespace).not.toHaveBeenCalled();
  });

  it("resumes the same activated Space and rejects a different transaction", async () => {
    expect((await activate()).status).toBe(200);
    expect((await activate()).status).toBe(200);
    expect((await activate(draftId, `0x${"c".repeat(64)}`)).status).toBe(403);
    expect(chain.deployedSpaceFromReceipt).toHaveBeenCalledTimes(1);
    expect(namespaces.provisionSpaceNamespace).toHaveBeenCalledTimes(2);
  });
});
