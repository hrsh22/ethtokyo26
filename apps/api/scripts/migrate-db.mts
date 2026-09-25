import { mkdir, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { databaseFile, databaseUrl } from "../src/db/file";

await mkdir(dirname(databaseFile()), { recursive: true, mode: 0o700 });
const connection = createClient({ url: databaseUrl() });
try {
  await migrate(drizzle(connection), { migrationsFolder: fileURLToPath(new URL("../drizzle-sqlite", import.meta.url)) });
  await chmod(databaseFile(), 0o600);
  console.log("SQLite migrations applied.");
} finally {
  connection.close();
}
