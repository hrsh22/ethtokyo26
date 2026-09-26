import { chmod, mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { AccordError } from "./types";

export async function privateDirectory(directory: string) { await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700); }
export async function savePrivate(path: string, value: unknown) {
  await privateDirectory(dirname(path)); const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
}
export async function loadPrivate<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new AccordError("state_unreadable", "The local profile or operation journal could not be read."); }
}
export async function withFileLock<T>(directory: string, key: string, work: () => Promise<T>): Promise<T> {
  await privateDirectory(directory);
  const path = join(directory, createHash("sha256").update(key).digest("hex"));
  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(path, { realpath: false, stale: 30_000, update: 5_000,
      retries: { retries: 20, factor: 1, minTimeout: 100, maxTimeout: 100 },
      // Stop the process on lost exclusivity; the durable journal is reconciled
      // on restart. Continuing to sign after losing the lock is unsafe.
      onCompromised: () => { throw new AccordError("lock_lost", "Signer lock lost. Restart and inspect the existing operation."); } });
  } catch { throw new AccordError("agent_busy", "Another Accord process is using this signer. Wait 30 seconds after a crash, then resume the same operation."); }
  try { return await work(); } finally { await release(); }
}
