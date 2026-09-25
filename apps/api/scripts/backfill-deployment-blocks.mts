/**
 * One-off: save the deployment block for Spaces activated before it was stored.
 * Some public RPCs stop serving receipts for older transactions, so set
 * BACKFILL_RPC_URL to one that still does (defaults to SEPOLIA_HISTORY_RPC_URL, then SEPOLIA_RPC_URL).
 */
import { createClient } from "@libsql/client";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createPublicClient, http, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { databaseUrl } from "../src/db/file";
import { spaceDrafts } from "../src/db/schema";

const rpc = process.env.BACKFILL_RPC_URL ?? process.env.SEPOLIA_HISTORY_RPC_URL ?? process.env.SEPOLIA_RPC_URL;
if (!rpc) throw new Error("Set BACKFILL_RPC_URL or SEPOLIA_RPC_URL.");
const chain = createPublicClient({ chain: sepolia, transport: http(rpc, { timeout: 20_000 }) });
if (await chain.getChainId() !== sepolia.id) throw new Error("The backfill RPC is not Ethereum Sepolia.");

const connection = createClient({ url: databaseUrl() });
try {
  const db = drizzle(connection);
  const rows = await db.select().from(spaceDrafts).where(and(isNotNull(spaceDrafts.deploymentTx), isNull(spaceDrafts.deploymentBlock)));
  for (const row of rows) {
    const receipt = await chain.getTransactionReceipt({ hash: row.deploymentTx as Hex }).catch(() => null);
    // The factory's SpaceCreated event indexes the Space address; require it so a wrong chain or hash can't be saved.
    const space = row.spaceAddress?.slice(2).toLowerCase();
    if (!receipt || !space || !receipt.logs.some((log) => log.topics.some((topic) => topic?.toLowerCase().endsWith(space)))) {
      console.log(`Skipped ${row.spaceAddress}: no matching receipt on this RPC.`);
      continue;
    }
    await db.update(spaceDrafts).set({ deploymentBlock: receipt.blockNumber.toString() }).where(eq(spaceDrafts.id, row.id));
    console.log(`Saved block ${receipt.blockNumber} for ${row.spaceAddress}.`);
  }
} finally {
  connection.close();
}
