/** Register ENS names/resolvers for existing Spaces. Pause the API while broadcasting
 * so this process and the API cannot race the registrar's transactions. */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { isNotNull } from "drizzle-orm";
import { databaseUrl } from "../src/db/file";
import { spaceDrafts } from "../src/db/schema";
import { namespaceName, provisionSpaceNamespace } from "../src/namespaces";
import { publicClient } from "../src/chain";

const broadcast = process.argv.includes("--broadcast");
if (await publicClient.getChainId() !== 11155111) throw new Error("Expected Ethereum Sepolia.");
const connection = createClient({ url: databaseUrl() });
try {
  const db = drizzle(connection);
  const drafts = await db.select().from(spaceDrafts).where(isNotNull(spaceDrafts.activatedAt));
  for (const draft of drafts) {
    if (!draft.spaceAddress) continue;
    console.log(JSON.stringify({ mode: broadcast ? "register" : "dry-run", space: draft.spaceAddress, name: namespaceName(draft).name }));
    if (broadcast) console.log(JSON.stringify({ registered: await provisionSpaceNamespace(db, draft) }));
  }
} catch {
  console.error("Space name registration stopped. Confirm the registrar balance and configuration, then rerun to resume.");
  process.exitCode = 1;
} finally {
  connection.close();
}
