import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";

/** An existing private archive, never created or migrated by the running API. */
export async function openDemoArchive(file: string) {
  const path = await realpath(file);
  // Keep a single connection so query_only applies to every archive query.
  const connection = createClient({ url: pathToFileURL(path).href, concurrency: 1 });
  try {
    await connection.execute("PRAGMA query_only = ON");
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}
