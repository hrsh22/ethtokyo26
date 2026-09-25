/** One-time copy from the old PostgreSQL store. Leaves the source untouched. */
import { createClient, type InValue } from "@libsql/client";
import pg from "pg";
import { databaseUrl } from "../src/db/file";

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("Set DATABASE_URL to the source PostgreSQL database for this one-time import.");

const tables = [
  "auth_challenges", "sessions", "space_drafts", "world_sessions",
  "world_challenges", "world_proofs", "permit_intents", "research_quotes",
] as const;
const source = new pg.Client({ connectionString: sourceUrl });
const target = createClient({ url: databaseUrl() });
const counts: Record<string, number> = {};
await source.connect();
try {
  await source.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const transaction = await target.transaction("write");
  try {
    for (const table of tables) {
      const existing = await transaction.execute(`SELECT count(*) AS count FROM "${table}"`);
      if (Number(existing.rows[0]?.count) !== 0) throw new Error(`SQLite table ${table} is not empty; import stopped without changing it.`);
    }
    for (const table of tables) {
      const records = (await source.query(`SELECT * FROM "${table}"`)).rows as Record<string, unknown>[];
      for (const record of records) {
        const columns = Object.keys(record);
        const placeholders = columns.map(() => "?").join(", ");
        const args = columns.map((column) => {
          const value = record[column];
          return value instanceof Date ? value.getTime() : value as InValue;
        });
        await transaction.execute({
          sql: `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${placeholders})`,
          args,
        });
      }
      const imported = await transaction.execute(`SELECT count(*) AS count FROM "${table}"`);
      if (Number(imported.rows[0]?.count) !== records.length) throw new Error(`Count mismatch for ${table}`);
      counts[table] = records.length;
    }
    await transaction.commit();
    await source.query("COMMIT");
    console.log(`Copied ${Object.values(counts).reduce((sum, count) => sum + count, 0)} records across ${tables.length} tables; PostgreSQL was not changed.`);
    for (const table of tables) console.log(`${table}: ${counts[table]}`);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
} finally {
  await source.end();
  target.close();
}
