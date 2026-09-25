import { Context, Effect, Layer } from "effect";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { databaseUrl } from "./file";

export type DatabaseClient = ReturnType<typeof drizzle>;

export class Database extends Context.Tag("accord/Database")<
  Database,
  { readonly client: DatabaseClient }
>() {}

export const DatabaseLive = Layer.scoped(
  Database,
  Effect.acquireRelease(
    Effect.sync(() => {
      const connection = createClient({ url: databaseUrl() });
      return { connection, client: drizzle(connection) };
    }),
    ({ connection }) => Effect.sync(() => connection.close()),
  ),
);
