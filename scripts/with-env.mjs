import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

const [script, ...args] = process.argv.slice(2);
if (!script) throw new Error("Provide a local Node executable path");
const child = spawn(process.execPath, [resolve(script), ...args], {
  stdio: "inherit",
  env: process.env,
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
