import { defineConfig } from "drizzle-kit";
import { resolve } from "node:path";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle-sqlite",
  dialect: "sqlite",
  dbCredentials: {
    url: `file:${resolve(process.env.DATABASE_FILE ?? "../../.data/accord.sqlite")}`,
  },
});
