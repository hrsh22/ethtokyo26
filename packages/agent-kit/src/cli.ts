#!/usr/bin/env node
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lstat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { AgentClient, AccordError, defaultApiUrl, defaultWebOrigin, pairingClient, type Pairing } from "./index";
import { createMcpServer } from "./mcp";
import { loadPrivate, savePrivate, withFileLock } from "./store";

type Profile = { version: 1; privateKey: Hex; apiUrl: string; webOrigin: string; rpcUrl?: string; pairing?: Pairing; connectionId?: string; agentName?: string };
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  profile: { type: "string", default: "default" }, agent: { type: "string" }, api: { type: "string" }, web: { type: "string" }, rpc: { type: "string" },
  help: { type: "boolean", short: "h" }, "no-wait": { type: "boolean" },
} });
const profileName = values.profile!;
if (!/^[a-zA-Z0-9_-]{1,48}$/.test(profileName)) throw new AccordError("invalid_profile", "Use a short profile name containing letters, numbers, underscores or dashes.");
const directory = join(homedir(), ".config", "accord", "profiles"), path = join(directory, `${profileName}.json`);
function client(p: Profile) {
  if (!p.connectionId || !p.agentName) throw new AccordError("not_connected", "Run accord connect and finish the owner's browser review first.");
  return new AgentClient({ ...p, connectionId: p.connectionId, agentName: p.agentName, signer: privateKeyToAccount(p.privateKey) });
}
async function profile() {
  const p = await loadPrivate<Profile>(path);
  if (!p) throw new AccordError("profile_missing", "Run accord init first.");
  const info = await lstat(path);
  if (info.isSymbolicLink() || (process.platform !== "win32" && (info.mode & 0o077))) throw new AccordError("profile_permissions", "The key file must be private to your user (chmod 600). Symbolic-link profiles are not supported.");
  if (p.version !== 1 || !/^0x[a-f0-9]{64}$/i.test(p.privateKey)) throw new AccordError("profile_invalid", "This profile is invalid. Use a separate profile for a new signer.");
  return p;
}
async function main() {
  const command = positionals[0];
  if (values.help || !command) {
    console.log("Accord agent toolkit · Sepolia\n\naccord init [--profile name] [--api url --web origin --rpc url]\naccord connect [--agent full-agent-name.eth] [--profile name]\naccord status [--profile name]\naccord mcp config [--profile name]\naccord mcp [--profile name]\naccord disconnect [--profile name]\n\nYour dedicated signer stays in a private local profile. Never paste its key into a prompt."); return;
  }
  if (command === "init") {
    await withFileLock(directory, `init:${profileName}`, async () => {
      if (await loadPrivate(path)) throw new AccordError("profile_exists", "This profile already exists. Choose a different --profile to create another signer.");
      const privateKey = generatePrivateKey();
      await savePrivate(path, { version: 1, privateKey, apiUrl: values.api ?? defaultApiUrl, webOrigin: values.web ?? defaultWebOrigin,
        ...(values.rpc ? { rpcUrl: values.rpc } : {}) } satisfies Profile);
      console.log(`Created profile ${profileName}.\nAgent signer: ${privateKeyToAccount(privateKey).address}\nNext: accord connect --profile ${profileName}`);
    }); return;
  }
  const p = await profile();
  if (command === "connect") {
    if (p.connectionId) { console.log(`Connected as ${p.agentName}. Use accord status, or disconnect before pairing again.`); return; }
    const pair = pairingClient({ ...p, signer: privateKeyToAccount(p.privateKey) });
    if (!p.pairing || Date.parse(p.pairing.expiresAt) <= Date.now()) {
      p.pairing = await pair.start(values.agent); await savePrivate(path, p);
    }
    console.log(`Open this link as the Space owner:\n${p.pairing.reviewUrl}\n\nReview the signer and choose its budget. Waiting for connection…`);
    do {
      const state = await pair.poll({ id: p.pairing.id, pollToken: p.pairing.pollToken });
      if (state.connectionId && state.name) {
        p.connectionId = state.connectionId; p.agentName = state.name; delete p.pairing;
        await savePrivate(path, p);
        const identity = await client(p).getIdentity();
        console.log(`Connected: ${identity.name}\nSpace: ${identity.spaceName}\nNext: accord mcp config --profile ${profileName}`); return;
      }
      if (values["no-wait"]) { console.log("Run accord connect again after completing the browser review."); return; }
      await delay(3000);
    } while (Date.parse(p.pairing.expiresAt) > Date.now());
    throw new AccordError("pairing_expired", "Pairing expired. Run accord connect again.");
  }
  if (command === "status") { console.log(JSON.stringify(await client(p).getIdentity(), null, 2)); return; }
  if (command === "disconnect") {
    await client(p).disconnect(); delete p.connectionId; delete p.agentName; delete p.pairing; await savePrivate(path, p);
    console.log("Tooling disconnected. To stop spending with cached permissions, revoke the agent's ENS authority in its Space."); return;
  }
  if (command === "mcp" && positionals[1] === "config") {
    client(p);
    console.log(JSON.stringify({ mcpServers: { accord: { command: process.execPath, args: [fileURLToPath(import.meta.url), "mcp", "--profile", profileName] } } }, null, 2)); return;
  }
  if (command === "mcp") {
    const agent = client(p);
    serveStdio(() => createMcpServer(agent), { onerror: () => console.error("Accord MCP transport error.") }); return;
  }
  throw new AccordError("unknown_command", "Unknown command. Run accord --help.");
}
main().catch(error => { console.error(error instanceof AccordError ? `${error.code}: ${error.message}` : "Accord could not complete this operation. Inspect its saved status before retrying."); process.exitCode = 1; });
