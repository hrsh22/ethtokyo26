import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const envFile = join(root, ".env");
if (existsSync(envFile)) loadEnvFile(envFile);

const webPort = Number(process.env.PORT ?? 3000);
const apiPort = Number(process.env.API_PORT ?? 4000);
const lockPath = join(root, "apps/web/.next/dev/lock");

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
  });
}

function lockHolder() {
  if (!existsSync(lockPath)) return undefined;
  let info;
  try {
    info = JSON.parse(readFileSync(lockPath, "utf8"));
    if (!Number.isInteger(info.pid) || !Number.isFinite(info.startedAt)) return undefined;
    const output = execFileSync("lsof", ["-t", lockPath], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    if (output.split(/\s+/).map(Number).includes(info.pid)) return info;
  } catch { /* An unlocked file does not prevent Next from starting. */ }
  return undefined;
}

async function waitForLockRelease(pid, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (lockHolder()?.pid !== pid) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return lockHolder()?.pid !== pid;
}

async function stopUnresponsiveNext(info) {
  console.log(`Stopping unresponsive Accord web server (PID ${info.pid}).`);
  process.kill(info.pid, "SIGTERM");
  if (await waitForLockRelease(info.pid, 3000)) return;
  if (lockHolder()?.pid === info.pid) process.kill(info.pid, "SIGKILL");
  if (!await waitForLockRelease(info.pid, 3000)) {
    throw new Error(`Next still holds ${lockPath}; stop PID ${info.pid} before retrying.`);
  }
}

async function apiIsRunning() {
  if (!await portIsOpen(apiPort)) return false;
  const response = await fetch(`http://127.0.0.1:${apiPort}/v1/health`, {
    signal: AbortSignal.timeout(1500),
  }).catch(() => undefined);
  if (!response) return false;
  const body = await response.json().catch(() => undefined);
  return response.ok && body?.status === "ok" && body?.chainId === 11155111;
}

async function main() {
  let webRunning = await portIsOpen(webPort);
  const holder = lockHolder();

  if (webRunning && !holder) {
    throw new Error(`Port ${webPort} is in use by another server. Free that port before starting Accord.`);
  }
  if (!webRunning && holder) {
    if (Date.now() - holder.startedAt < 30_000) {
      console.log(`Accord web server is already starting (PID ${holder.pid}).`);
      return;
    }
    await stopUnresponsiveNext(holder);
  }

  webRunning = await portIsOpen(webPort);
  const apiRunning = await apiIsRunning();
  if (!apiRunning && await portIsOpen(apiPort)) {
    throw new Error(`Port ${apiPort} is in use by another API. Free that port before starting Accord.`);
  }
  if (webRunning && apiRunning) {
    console.log(`Accord is already running: http://localhost:${webPort} (API ${apiPort}).`);
    return;
  }

  const filters = [
    ...(!apiRunning ? ["--filter=@accord/api"] : []),
    ...(!webRunning ? ["--filter=@accord/web"] : []),
  ];
  if (apiRunning) console.log(`Reusing Accord API on port ${apiPort}.`);
  if (webRunning) console.log(`Reusing Accord web server on port ${webPort}.`);

  const child = spawn("pnpm", ["exec", "turbo", "dev", ...filters], {
    cwd: root,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      try {
        process.kill(process.platform === "win32" ? child.pid : -child.pid, signal);
      } catch { /* The child has already exited. */ }
    });
  }
  child.on("error", (error) => {
    console.error(`Could not start Accord dev servers: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
