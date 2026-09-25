// Disposable Next route for reviewing the real components with deterministic local data.
import { mkdir, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
const route = new URL("../src/app/space-ux-preview/", import.meta.url);
await mkdir(route); // Refuse to overwrite an existing route.
await writeFile(new URL("page.tsx", route), 'import { notFound } from "next/navigation";\nimport Fixture from "../../../test/space-ux-fixture";\nexport default function Preview() { if (process.env.NODE_ENV !== "development") notFound(); return <Fixture />; }\n');
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", process.env.PORT || "3002"], {
  cwd: new URL("../", import.meta.url), stdio: "inherit",
});
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
  await rm(route, { recursive: true, force: true });
  // Next caches validators that still import the now-removed temporary route.
  await rm(new URL("../.next/dev/types/", import.meta.url), { recursive: true, force: true });
  process.exit(code);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
child.on("exit", (code) => void stop(code ?? 0));
