import { resolve } from "node:path";

export function databaseFile() {
  return resolve(process.env.DATABASE_FILE ?? "../../.data/accord.sqlite");
}

export function databaseUrl() {
  return `file:${databaseFile()}`;
}
