import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openDemoArchive } from "./demo-archive";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("demo evidence archive", () => {
  it("allows concurrent reads but rejects changes to archived records", async () => {
    const directory = await mkdtemp(join(tmpdir(), "accord-demo-archive-"));
    directories.push(directory);
    const file = join(directory, "evidence.sqlite");
    const writer = createClient({ url: pathToFileURL(file).href });
    try {
      await writer.execute("CREATE TABLE evidence (id TEXT PRIMARY KEY)");
      await writer.execute("INSERT INTO evidence VALUES ('recorded-purchase')");
    } finally { writer.close(); }

    const archive = await openDemoArchive(file);
    try {
      const reads = await Promise.all(Array.from({ length: 6 }, () => archive.execute("SELECT id FROM evidence")));
      expect(reads.every(result => result.rows[0]?.id === "recorded-purchase")).toBe(true);
      await expect(archive.execute("DELETE FROM evidence")).rejects.toThrow();
      await expect(archive.execute("INSERT INTO evidence VALUES ('fabricated')")).rejects.toThrow();
      expect((await archive.execute("SELECT id FROM evidence")).rows.map(row => row.id)).toEqual(["recorded-purchase"]);
    } finally { archive.close(); }
  });

  it("rejects a missing archive without creating a replacement database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "accord-demo-archive-"));
    directories.push(directory);
    const file = join(directory, "missing.sqlite");
    await expect(openDemoArchive(file)).rejects.toThrow();
    await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
