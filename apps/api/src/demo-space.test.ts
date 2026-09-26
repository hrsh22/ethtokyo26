import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { HttpApiBuilder, HttpServer } from "@effect/platform";
import { Layer } from "effect";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { ApiLive } from "./app";
import { Database } from "./db";
import { spaceDrafts } from "./db/schema";
import { demoManifest as m } from "./demo-manifest";
import { publicDraftRead, publicSpaceRead } from "./demo-space";

const other = "0x3333333333333333333333333333333333333333";
const ids = { demo: "06bda1d7-bbe3-4674-bdf6-59afd0ece1cf", other: "11111111-1111-4111-8111-111111111111", live: "22222222-2222-4222-8222-222222222222" };
const draft = (id: string, spaceAddress: string, name: string) => ({ id, owner: m.owner.toLowerCase(), name, templateId: "research-budget",
  spaceAddress, tokenAddress: m.token, deploymentTx: `0x${id.replaceAll("-", "").padEnd(64, "0")}`, deploymentBlock: "100", activatedAt: new Date() });
const connections: ReturnType<typeof createClient>[] = [];
async function database() {
  const connection = createClient({ url: ":memory:" }), db = drizzle(connection);
  connections.push(connection);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle-sqlite", import.meta.url)) });
  return db;
}
let app: Awaited<ReturnType<typeof database>>, archive: Awaited<ReturnType<typeof database>>;
beforeEach(async () => {
  app = await database(); archive = await database();
  await archive.insert(spaceDrafts).values([draft(ids.demo, m.spaceAddress, "Tokyo Team"), draft(ids.other, other, "Archived elsewhere")]);
});
afterEach(() => { for (const connection of connections.splice(0)) connection.close(); });
const read = (address: string) => (client: typeof app) => client.select().from(spaceDrafts).where(eq(spaceDrafts.spaceAddress, address));

describe("public reads for the published demo Space", () => {
  it("fall back to the archive only for the demo Space after an app reset", async () => {
    const demo = await publicSpaceRead({ client: app, demoClient: archive }, m.spaceAddress, read(m.spaceAddress));
    expect(demo).toMatchObject({ archived: true, rows: [{ name: "Tokyo Team" }] });
    expect((await publicSpaceRead({ client: app, demoClient: archive }, other, read(other))).rows).toHaveLength(0);
    expect((await publicDraftRead({ client: app, demoClient: archive }, c => c.select().from(spaceDrafts).where(eq(spaceDrafts.id, ids.other)))).rows).toHaveLength(0);
    expect((await publicDraftRead({ client: app, demoClient: archive }, c => c.select().from(spaceDrafts).where(eq(spaceDrafts.id, ids.demo)))).rows).toHaveLength(1);
  });
  it("prefer the app database whenever it knows the Space", async () => {
    await app.insert(spaceDrafts).values(draft(ids.live, m.spaceAddress, "Live name"));
    const result = await publicSpaceRead({ client: app, demoClient: archive }, m.spaceAddress, read(m.spaceAddress));
    expect(result).toMatchObject({ archived: false, rows: [{ name: "Live name" }] });
  });
  it("serve the archived Space name through the public profile route", async () => {
    const api = HttpApiBuilder.toWebHandler(Layer.mergeAll(ApiLive.pipe(Layer.provide(Layer.succeed(Database, { client: app, demoClient: archive }))), HttpServer.layerContext));
    try {
      const profile = (address: string) => api.handler(new Request("http://localhost/v1/spaces/profile", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceAddress: address }) }));
      const demo = await profile(m.spaceAddress);
      expect(demo.status).toBe(200);
      expect(await demo.json()).toMatchObject({ id: ids.demo, name: "Tokyo Team" });
      expect((await profile(other)).status).toBe(404);
    } finally { await api.dispose(); }
  });
});
