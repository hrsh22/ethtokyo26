/** Disposable local browser E2E environment. Never loads a real wallet key into the signer. */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { WalletKit } from "@reown/walletkit";
import type { WalletKitTypes } from "@reown/walletkit";
import { Core } from "@walletconnect/core";
import { buildApprovedNamespaces, getSdkError } from "@walletconnect/utils";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createPublicClient, createWalletClient, decodeEventLog, erc20Abi, hexToString, http, isAddress, isHex, parseEther, zeroAddress, type Abi, type Hex } from "viem";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { labelhash, namehash } from "viem/ens";
import { parseSiweMessage } from "viem/siwe";
import { spaceAccountAbi, spaceFactoryAbi } from "@accord/chain";

const rpc = "http://127.0.0.1:8546";
const web = "http://localhost:3001";
const api = "http://127.0.0.1:4001";
const control = "http://localhost:4101";
const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID;
if (!projectId) throw new Error("Reown project ID is required");
const dbName = `accord_e2e_${randomBytes(6).toString("hex")}`;
const tempDirectory = await mkdtemp(join(tmpdir(), `${dbName}_`));
const dbFile = join(tempDirectory, "accord.sqlite");
const owner = privateKeyToAccount(generatePrivateKey());
const recipient = privateKeyToAccount(generatePrivateKey()).address;
const blockedRecipient = privateKeyToAccount(generatePrivateKey()).address;
const unavailableRecipient = privateKeyToAccount(generatePrivateKey()).address;
const signerKey = generatePrivateKey();
const funder = mnemonicToAccount("test test test test test test test test test test test junk");
const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
const walletClient = createWalletClient({ account: owner, chain: sepolia, transport: http(rpc) });
const children: ChildProcess[] = [];
const baseEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
const statePath = new URL("../../../.codex/browser-e2e-state.json", import.meta.url);
const transactions: Array<{ hash: Hex; to: string; selector: string; status: string }> = [];
let space: Hex | undefined;
let stopping = false;
let dropNextTransactionResponse = false;
let controlServer: ReturnType<typeof createServer> | undefined;
async function cleanup(exitCode = 0) {
  if (stopping) return; stopping = true;
  controlServer?.close();
  for (const child of children) child.kill("SIGTERM");
  await delay(600);
  await rm(tempDirectory, { recursive: true, force: true });
  process.exit(exitCode);
}
process.on("SIGINT", () => void cleanup());
process.on("SIGTERM", () => void cleanup());
process.on("uncaughtException", (error) => { console.error(error.message); void cleanup(1); });
process.on("unhandledRejection", (error) => { console.error(error instanceof Error ? error.message : "Local harness failed"); void cleanup(1); });

async function portFree(port: number) {
  const server = createTcpServer();
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
function start(command: string, args: string[], cwd: URL, env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  child.stdout?.resume();
  child.stderr?.on("data", (data) => {
    const message = String(data).replace(/wc:[^\s]+/g, "[pairing]").replace(/0x[0-9a-fA-F]{64}/g, "[redacted]");
    if (!message.includes("Browserslist")) process.stderr.write(message);
  });
  return child;
}
async function ready(url: string) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await delay(200);
  }
  throw new Error(`Service did not start: ${url}`);
}
async function artifact(name: string) {
  return JSON.parse(await readFile(new URL(`../../../contracts/out/${name}.json`, import.meta.url), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
}
async function deploy(name: string, args: readonly unknown[] = []) {
  const compiled = await artifact(name);
  const hash = await walletClient.deployContract({ abi: compiled.abi, bytecode: compiled.bytecode.object, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Local deployment failed: ${name}`);
  return { address: receipt.contractAddress, abi: compiled.abi };
}

await Promise.all([3001, 4001, 4101, 8546].map(portFree));
start("anvil", ["--port", "8546", "--chain-id", "11155111", "--silent"], new URL("../../../", import.meta.url), baseEnv);
for (let i = 0; ; i++) {
  try { if ((await publicClient.getChainId()) === 11155111) break; } catch { /* starting */ }
  if (i > 30) throw new Error("Local Anvil did not start");
  await delay(100);
}
if (!(await publicClient.request({ method: "web3_clientVersion" })).toLowerCase().includes("anvil")) throw new Error("Test signer requires Anvil");
await publicClient.waitForTransactionReceipt({ hash: await walletClient.sendTransaction({ account: funder, to: owner.address, value: parseEther("10") }) });
const testConnection = createClient({ url: `file:${dbFile}` });
await migrate(drizzle(testConnection), { migrationsFolder: fileURLToPath(new URL("../drizzle-sqlite", import.meta.url)) });
testConnection.close();
const token = await deploy("SpaceAccount.t.sol/DemoToken");
const adapter = await deploy("EnsPermissionAdapter.sol/EnsPermissionAdapter");
const factory = await deploy("SpaceFactory.sol/SpaceFactory", [zeroAddress]);
const registry = await deploy("SpaceAccount.t.sol/MockEnsV2Registry");
const resolver = await deploy("MockRecipientResolver.sol/MockRecipientResolver");
await publicClient.waitForTransactionReceipt({ hash: await walletClient.writeContract({ address: resolver.address, abi: resolver.abi, functionName: "setAddress", args: [namehash("family.eth"), owner.address] }) });
await publicClient.waitForTransactionReceipt({ hash: await walletClient.writeContract({ address: token.address, abi: token.abi, functionName: "mint", args: [owner.address, parseEther("1000")] }) });
const block = await publicClient.getBlock();
await publicClient.waitForTransactionReceipt({ hash: await walletClient.writeContract({ address: registry.address, abi: registry.abi, functionName: "setState", args: [BigInt(labelhash("agent")), 2, owner.address, block.timestamp + 30n * 86400n, 7n] }) });
const manifest = { web, api, control, rpc, database: dbName, owner: owner.address, recipient, blockedRecipient, unavailableRecipient, token: token.address, factory: factory.address, registry: registry.address, agentName: "agent.eth", humanName: "family.eth", resolver: resolver.address, simulatedPartners: true };
async function save() {
  await mkdir(new URL("../../../.codex/", import.meta.url), { recursive: true });
  await writeFile(statePath, JSON.stringify({ ...manifest, space, transactions }, null, 2) + "\n", { mode: 0o600 });
}
await save();
start(process.execPath, ["--import", "./scripts/mock-partners.mjs", "--import", "tsx", "src/index.ts"], new URL("../", import.meta.url), {
  ...baseEnv, RESEARCH_SELLER_ADDRESS: recipient, API_PORT: "4001", API_HOST: "127.0.0.1", WEB_ORIGIN: web, DATABASE_FILE: dbFile, SEPOLIA_RPC_URL: rpc,
  PERMIT_SIGNER_PRIVATE_KEY: signerKey, SPACE_FACTORY_ADDRESS: factory.address, ENS_ADAPTER_ADDRESS: adapter.address,
  ENSV2_REGISTRY_ADDRESS: registry.address, ENSV2_UNIVERSAL_RESOLVER_ADDRESS: resolver.address, DEMO_TOKEN_ADDRESS: token.address,
  WORLD_APP_ID: "app_local_anvil", WORLD_RP_ID: "rp_local_anvil", WORLD_RP_SIGNING_KEY: generatePrivateKey(), WORLD_ENVIRONMENT: "staging",
  ACCORD_PARTNER_MOCKS: "local-only", INTERCEPTA_API_KEY: "local-test-only", ACCORD_SESSION_COOKIE_NAME: "accord_e2e_session",
  MOCK_INTERCEPTA_BLOCK_ADDRESS: blockedRecipient, MOCK_INTERCEPTA_ERROR_ADDRESS: unavailableRecipient,
});
await ready(`${api}/v1/health`);
start(process.execPath, ["./node_modules/next/dist/bin/next", "dev", "--port", "3001", "--hostname", "127.0.0.1"], new URL("../../web/", import.meta.url), {
  ...baseEnv, ACCORD_LOCAL_E2E: "1", API_URL: api, NEXT_PUBLIC_SEPOLIA_RPC_URL: rpc,
  NEXT_PUBLIC_REOWN_PROJECT_ID: projectId, NEXT_PUBLIC_DEMO_SPACE_ADDRESS: "",
});

const core = new Core({ projectId, customStoragePrefix: dbName, telemetryEnabled: false });
const wc = await WalletKit.init({ core: core as unknown as WalletKitTypes.Options["core"], metadata: { name: "Accord local E2E wallet", description: "Disposable Anvil-only signer", url: web, icons: [] } });
const approved = new Set<string>();
wc.on("session_proposal", async ({ id, params }) => {
  const metadata = params.proposer.metadata;
  if (!metadata.name.startsWith("Accord") || new URL(metadata.url).origin !== web) {
    await wc.rejectSession({ id, reason: getSdkError("USER_REJECTED") }); return;
  }
  try {
    const session = await wc.approveSession({ id, namespaces: buildApprovedNamespaces({ proposal: params,
      supportedNamespaces: { eip155: { accounts: [`eip155:11155111:${owner.address}`], chains: ["eip155:11155111"], methods: ["personal_sign", "eth_sendTransaction"], events: ["accountsChanged", "chainChanged"] } } }) });
    approved.add(session.topic); console.log("Local browser wallet paired.");
  } catch { console.error("Local wallet proposal rejected."); }
});
wc.on("session_request", async (event) => {
  const { id, topic, params } = event;
  try {
    if (!approved.has(topic) || params.chainId !== "eip155:11155111") throw new Error("Unapproved local session");
    const request = params.request;
    let result: Hex;
    if (request.method === "personal_sign") {
      const [message, address] = request.params as [string, string];
      const text = isHex(message) ? hexToString(message) : message;
      const siwe = parseSiweMessage(text);
      if (address.toLowerCase() !== owner.address.toLowerCase() || siwe.domain !== "localhost:3001" || siwe.uri !== web || siwe.chainId !== 11155111 || siwe.address?.toLowerCase() !== owner.address.toLowerCase()) throw new Error("Only local Accord login is allowed");
      result = await owner.signMessage({ message: text });
    } else if (request.method === "eth_sendTransaction") {
      const [tx] = request.params as [{ from: string; to: string; data: Hex; value?: Hex }];
      if (tx.from.toLowerCase() !== owner.address.toLowerCase() || !isAddress(tx.to) || !isHex(tx.data) || BigInt(tx.value ?? "0x0") !== 0n || !(await publicClient.getBytecode({ address: tx.to }))) throw new Error("Only local contract calls with zero native value are allowed");
      result = await walletClient.sendTransaction({ to: tx.to, data: tx.data, value: 0n });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: result });
      transactions.push({ hash: result, to: tx.to, selector: tx.data.slice(0, 10), status: receipt.status });
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== factory.address.toLowerCase()) continue;
        try { space = decodeEventLog({ abi: spaceFactoryAbi, eventName: "SpaceCreated", data: log.data, topics: log.topics }).args.space; } catch { /* another event */ }
      }
      await save(); console.log(`Local transaction ${transactions.length}: ${receipt.status}`);
      if (dropNextTransactionResponse) {
        dropNextTransactionResponse = false;
        console.log("Local test wallet deliberately dropped a transaction response after mining.");
        return;
      }
    } else throw new Error("Unsupported local test method");
    await wc.respondSessionRequest({ topic, response: { id, jsonrpc: "2.0", result } });
  } catch (error) {
    const summary = error instanceof Error && "shortMessage" in error && typeof error.shortMessage === "string"
      ? error.shortMessage : error instanceof Error ? (error.message.split("\n")[0] ?? "Unknown local wallet error") : "Unknown local wallet error";
    console.error(`Local wallet rejected ${params.request.method}: ${summary.slice(0, 160)}`);
    await wc.respondSessionRequest({ topic, response: { id, jsonrpc: "2.0", error: { code: 4001, message: "Local wallet rejected this request" } } });
  }
});

const server = createServer(async (request, response) => {
  response.setHeader("content-type", "text/html"); response.setHeader("cache-control", "no-store");
  if (request.method === "POST" && request.url === "/drop-next-response" && request.headers.origin === control) {
    dropNextTransactionResponse = true;
    response.end("<p>The next mined transaction response will be dropped.</p><a href='/'>Back</a>"); return;
  }
  if (request.method === "POST" && request.url === "/pair" && request.headers.origin === control) {
    let body = "";
    for await (const chunk of request) { body += String(chunk); if (body.length > 4096) { response.writeHead(413).end(); return; } }
    const uri = new URLSearchParams(body).get("uri") ?? "";
    if (!/^wc:[^\s]+$/.test(uri)) { response.writeHead(400).end("Invalid pairing"); return; }
    try { await wc.pair({ uri }); response.end("<p>Local pairing sent.</p><a href='/'>Back</a>"); }
    catch { response.writeHead(400).end("Pairing expired or failed. Copy a fresh link."); }
    return;
  }
  if (request.url === "/state") {
    response.setHeader("content-type", "application/json");
    const [ownerBalance, recipientBalance] = await Promise.all([owner.address, recipient].map((address) => publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [address] })));
    const allocations = space ? await Promise.all([1n, 2n].map((id) => publicClient.readContract({ address: space!, abi: spaceAccountAbi, functionName: "allocations", args: [id] }))) : [];
    response.end(JSON.stringify({ ...manifest, space, transactions, ownerBalance, recipientBalance, allocations }, (_, v) => typeof v === "bigint" ? v.toString() : v)); return;
  }
  response.end(`<h1>Accord local E2E control</h1><p>Disposable Anvil wallet. All partner responses are fixtures.</p><form method='POST' action='/pair'><label for='uri'>Pairing link</label><input type='password' id='uri' name='uri' autocomplete='off'><button>Pair local wallet</button></form><form method='POST' action='/drop-next-response'><button>Drop next transaction response</button></form><pre>${JSON.stringify({ ...manifest, space, transactions }, null, 2)}</pre>`);
});
controlServer = server;
server.listen(4101, "127.0.0.1");
await ready(web);
console.log(JSON.stringify({ ...manifest, status: "ready" }));
await new Promise(() => {});
