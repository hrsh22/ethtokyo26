import { Context, Effect, Layer } from "effect";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { databaseUrl } from "./file";
import { openDemoArchive } from "./demo-archive";

export type DatabaseClient = ReturnType<typeof drizzle>;

export class Database extends Context.Tag("accord/Database")<
  Database,
  { readonly client: DatabaseClient; readonly demoClient?: DatabaseClient }
>() {}

export const DatabaseLive = Layer.scoped(
  Database,
  Effect.acquireRelease(
    Effect.promise(async () => {
      const connection = createClient({ url: databaseUrl() });
      try {
        const archiveFile = process.env.DEMO_EVIDENCE_DATABASE_FILE?.trim();
        const archive = archiveFile ? await openDemoArchive(archiveFile) : undefined;
        return { connection, archive, client: drizzle(connection), demoClient: archive ? drizzle(archive) : undefined };
      } catch (error) {
        connection.close();
        throw error;
      }
    }),
    ({ connection, archive }) => Effect.sync(() => { archive?.close(); connection.close(); }),
  ),
);
