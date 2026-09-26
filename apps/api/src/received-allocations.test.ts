import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { historyClient } from "./chain";
import { agentPolicies, receivedAllocations, spaceDrafts } from "./db/schema";
import { zeroAddress } from "viem";
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
        { kind: "person", spaceAddress: space, allocationId: "1", spaceName: "Support", createdBlock: "101" },
      ]);
      expect(logs).toHaveBeenCalledWith(expect.objectContaining({ address: space, fromBlock: 100n, toBlock: 105n }));
      expect(await listReceivedAllocations(db, person)).toEqual([
        { kind: "person", spaceAddress: space, allocationId: "4", spaceName: "Support", createdBlock: "106" },
        { kind: "person", spaceAddress: space, allocationId: "1", spaceName: "Support", createdBlock: "101" },
      ]);
      expect(logs).toHaveBeenLastCalledWith(expect.objectContaining({ address: space, fromBlock: 106n, toBlock: 107n }));
      expect(head).toHaveBeenCalledTimes(2);
      expect((await db.select().from(receivedAllocations)).map((row) => row.allocationId)).toEqual(["1", "2", "4"]);
      expect((await listReceivedAllocations(db, another)).map((row) => row.allocationId)).toEqual(["2"]);
      expect(head).toHaveBeenCalledTimes(3);
      expect(logs).toHaveBeenCalledTimes(2);
    } finally { connection.close(); }
  });
  it("keeps both roles for one wallet, deduplicates grants, and excludes unsubmitted or reassigned agents", async () => {
    const connection = createClient({ url: ":memory:" });
    try {
      const db = drizzle(connection);
      await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle-sqlite", import.meta.url)) });
      await db.insert(spaceDrafts).values({ id: crypto.randomUUID(), owner, name: "Support",
        templateId: "recurring-support", spaceAddress: space, deploymentTx, deploymentBlock: "100", activatedAt: new Date() });
      for (const id of ["2", "2", "3", "4", "5"]) await db.insert(agentPolicies).values({
        requestId: crypto.randomUUID(), spaceAddress: space, allocationId: id, name: `agent-${id}.eth`,
        agent: person, registry: space, nameId: "1", resource: "1", dailyCap: "100", maxPerPayment: "10",
        approvalThreshold: "1", expiry: "1000", permitRequestId: deploymentTx,
        ...(id === "5" ? { revokedAt: new Date() } : {}),
      });
      vi.spyOn(historyClient, "getBlockNumber").mockResolvedValue(105n);
      vi.spyOn(historyClient, "getLogs").mockResolvedValue([created(1n, person, 101n), created(2n, zeroAddress, 102n)]);
      const reads = vi.spyOn(historyClient, "readContract").mockImplementation(async (args) => {
        if (args.functionName === "allocations") return [zeroAddress, 100n, 100n, 0n, 0n, 0, false] as never;
        const id = String(args.args![0]);
        return [id === "3" ? zeroAddress : id === "4" ? another : person, space, 1n, 1n, 100n, 10n, 0n, 0n, 1000n, id !== "5"] as never;
      });
      expect((await listReceivedAllocations(db, person)).map(({ allocationId, kind }) => ({ allocationId, kind }))).toEqual([
        { allocationId: "5", kind: "agent" }, { allocationId: "2", kind: "agent" }, { allocationId: "1", kind: "person" },
      ]);
      expect(reads).toHaveBeenCalledTimes(8);
      for (const [args] of reads.mock.calls) expect(args.blockNumber).toBe(105n);
    } finally { connection.close(); }
  });
});
