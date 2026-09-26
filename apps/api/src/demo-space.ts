import type { DatabaseClient } from "./db";
import { demoManifest } from "./demo-manifest";

type Databases = { readonly client: DatabaseClient; readonly demoClient?: DatabaseClient };
const isDemoSpace = (address?: string | null) => !!address && address.toLowerCase() === demoManifest.spaceAddress.toLowerCase();

/**
 * Public reads for one Space. After an app reset, the published demo Space's records remain only in the
 * read-only demo archive, so its public pages fall back there. Other Spaces never read the archive.
 */
export async function publicSpaceRead<T>(db: Databases, spaceAddress: string, read: (client: DatabaseClient) => Promise<T[]>) {
  const rows = await read(db.client);
  if (rows.length || !db.demoClient || !isDemoSpace(spaceAddress)) return { client: db.client, rows, archived: false };
  return { client: db.demoClient, rows: await read(db.demoClient), archived: true };
}

/** The same fallback when only the draft ID is known: archived rows are used only if they belong to the demo Space. */
export async function publicDraftRead<T extends { spaceAddress: string | null }>(db: Databases, read: (client: DatabaseClient) => Promise<T[]>) {
  const rows = await read(db.client);
  if (rows.length || !db.demoClient) return { client: db.client, rows };
  const archived = await read(db.demoClient);
  return archived.length && archived.every(row => isDemoSpace(row.spaceAddress)) ? { client: db.demoClient, rows: archived } : { client: db.client, rows };
}
