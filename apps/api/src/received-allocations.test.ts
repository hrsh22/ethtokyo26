import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { historyClient } from "./chain";
import { receivedAllocations, spaceDrafts } from "./db/schema";
import { listReceivedAllocations } from "./received-allocations";

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const owner = address("1");
const person = address("2");
const another = address("3");
const space = address("4");
const deploymentTx = `0x${"a".repeat(64)}`;

function created(id: bigint, beneficiary: `0x${string}`, blockNumber: bigint) {
  return { args: { allocationId: id, beneficiary, amount: 100n }, blockNumber } as never;
}

afterEach(() => vi.restoreAllMocks());

describe("received allowance discovery", () => {
  it("backfills existing person allowances and indexes only new blocks later", async () => {
    const connection = createClient({ url: ":memory:" });
    try {
      const db = drizzle(connection);
      await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle-sqlite", import.meta.url)) });
      await db.insert(spaceDrafts).values({ id: crypto.randomUUID(), owner, name: "Support",
        templateId: "recurring-support", spaceAddress: space, deploymentTx,
        deploymentBlock: "100", activatedAt: new Date() });
      const head = vi.spyOn(historyClient, "getBlockNumber").mockResolvedValue(107n).mockResolvedValueOnce(105n);
      const logs = vi.spyOn(historyClient, "getLogs")
        .mockResolvedValueOnce([created(1n, person, 101n), created(2n, another, 102n), created(3n, address("0"), 103n)])
        .mockResolvedValueOnce([created(4n, person, 106n)]);

      expect(await listReceivedAllocations(db, person)).toEqual([
        { spaceAddress: space, allocationId: "1", spaceName: "Support", createdBlock: "101" },
      ]);
      expect(logs).toHaveBeenCalledWith(expect.objectContaining({ address: space, fromBlock: 100n, toBlock: 105n }));
      expect(await listReceivedAllocations(db, person)).toEqual([
        { spaceAddress: space, allocationId: "4", spaceName: "Support", createdBlock: "106" },
        { spaceAddress: space, allocationId: "1", spaceName: "Support", createdBlock: "101" },
      ]);
      expect(logs).toHaveBeenLastCalledWith(expect.objectContaining({ address: space, fromBlock: 106n, toBlock: 107n }));
      expect(head).toHaveBeenCalledTimes(2);
      expect((await db.select().from(receivedAllocations)).map((row) => row.allocationId)).toEqual(["1", "2", "4"]);
      expect((await listReceivedAllocations(db, another)).map((row) => row.allocationId)).toEqual(["2"]);
      expect(head).toHaveBeenCalledTimes(3);
      expect(logs).toHaveBeenCalledTimes(2);
    } finally { connection.close(); }
  });
});
