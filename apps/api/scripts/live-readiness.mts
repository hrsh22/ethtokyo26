/** Read-only preflight. Never submits a transaction or prints credentials/provider URLs. */
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { createPublicClient, erc20Abi, formatEther, getAddress, http, isAddress, zeroAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { ensPermissionAdapterAbi, spaceAccountAbi } from "@accord/chain";
import { screenRecipient } from "../src/risk";
import { databaseUrl } from "../src/db/file";

type Check = { name: string; status: "pass" | "waiting" | "fail"; detail: string };
const checks: Check[] = [];
const api = process.env.API_URL ?? "http://localhost:4000";
const rpc = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const chain = createPublicClient({ chain: sepolia, transport: http(rpc, { timeout: 12_000, retryCount: 1 }) });
async function check(name: string, work: () => Promise<string>, failure: string) {
  try { checks.push({ name, status: "pass", detail: await work() }); }
  catch { checks.push({ name, status: "fail", detail: failure }); }
}
function configuredAddress(name: string): Address {
  const value = process.env[name];
  if (!value || !isAddress(value) || value.toLowerCase() === zeroAddress) throw Error();
  return getAddress(value);
}
async function get(path: string) {
  const response = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw Error();
  return await response.json() as Record<string, unknown>;
}
function walletAddress(keyName: string): Address {
  const key = process.env[keyName];
  if (!key || !/^0x[0-9a-f]{64}$/i.test(key)) throw Error();
  return privateKeyToAccount(key as `0x${string}`).address;
}
await Promise.all([
  check("API deployment", async () => {
    const value = await get("/v1/config");
    for (const [field, env] of [["factoryAddress", "SPACE_FACTORY_ADDRESS"], ["adapterAddress", "ENS_ADAPTER_ADDRESS"],
      ["demoTokenAddress", "DEMO_TOKEN_ADDRESS"], ["ensRegistryAddress", "ENSV2_REGISTRY_ADDRESS"]]) {
      if (String(value[field!]).toLowerCase() !== configuredAddress(env!).toLowerCase()) throw Error();
    }
    if (!value.configured || String(value.authorizerAddress).toLowerCase() !== walletAddress("PERMIT_SIGNER_PRIVATE_KEY").toLowerCase()) throw Error();
    return "Running API matches local deployment and permit signer.";
  }, "Start/restart the API and check its deployment configuration."),
  check("Database migrations", async () => {
    const connection = createClient({ url: databaseUrl() });
    try {
      await connection.execute("SELECT id, actor, transaction_hash FROM research_quotes LIMIT 0");
      await connection.execute("SELECT world_verified_at, risk_checked_at, signature FROM permit_intents LIMIT 0");
      return "Purchase and authorization tables are available.";
    } finally { connection.close(); }
  }, "Check DATABASE_FILE and run pnpm --filter @accord/api db:migrate."),
  check("Sepolia RPCs", async () => {
    const browser = createPublicClient({ transport: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? rpc, { timeout: 12_000, retryCount: 1 }) });
    const ids = await Promise.all([chain.getChainId(), browser.getChainId()]);
    if (ids.some((id) => id !== sepolia.id)) throw Error();
    if ((await chain.request({ method: "web3_clientVersion" })).toLowerCase().includes("anvil")) throw Error();
    return "API and browser endpoints use public Sepolia.";
  }, "Check both RPC configurations; live mode must use public Sepolia."),
  check("Contracts", async () => {
    await Promise.all(["SPACE_FACTORY_ADDRESS", "ENS_ADAPTER_ADDRESS", "ENSV2_REGISTRY_ADDRESS", "DEMO_TOKEN_ADDRESS"].map(async (name) => {
      if (!await chain.getBytecode({ address: configuredAddress(name) })) throw Error();
    }));
    return "Factory, ENS adapter/registry, and demo token have deployed code.";
  }, "A configured address has no readable deployed code."),
  check("Demo allocations and ENS authority", async () => {
    const address = configuredAddress("NEXT_PUBLIC_DEMO_SPACE_ADDRESS");
    const block = await chain.getBlock();
    const [authorizer, token, adapter, allocation, humanAllocation, mandate, owner] = await Promise.all([
      chain.readContract({ address, abi: spaceAccountAbi, functionName: "authorizer", blockNumber: block.number }),
      chain.readContract({ address, abi: spaceAccountAbi, functionName: "token", blockNumber: block.number }),
      chain.readContract({ address, abi: spaceAccountAbi, functionName: "ensAdapter", blockNumber: block.number }),
      chain.readContract({ address, abi: spaceAccountAbi, functionName: "allocations", args: [2n], blockNumber: block.number }),
      chain.readContract({ address, abi: spaceAccountAbi, functionName: "allocations", args: [1n], blockNumber: block.number }),
      chain.readContract({ address, abi: spaceAccountAbi, functionName: "mandates", args: [2n], blockNumber: block.number }),
      chain.readContract({ address, abi: spaceAccountAbi, functionName: "owner", blockNumber: block.number }),
    ]);
    const human = process.env.DEMO_BENEFICIARY_ADDRESS ? configuredAddress("DEMO_BENEFICIARY_ADDRESS") : walletAddress("DEMO_HUMAN_PRIVATE_KEY");
    const price = BigInt(process.env.RESEARCH_PRICE_BASE_UNITS ?? "1000000000000000000");
    const spent = mandate[7] === block.timestamp / 86400n ? mandate[6] : 0n;
    if (authorizer.toLowerCase() !== walletAddress("PERMIT_SIGNER_PRIVATE_KEY").toLowerCase() ||
      owner.toLowerCase() !== walletAddress("DEPLOYER_PRIVATE_KEY").toLowerCase() ||
      humanAllocation[0].toLowerCase() !== human.toLowerCase() || mandate[0].toLowerCase() !== walletAddress("DEMO_AGENT_PRIVATE_KEY").toLowerCase() ||
      token.toLowerCase() !== configuredAddress("DEMO_TOKEN_ADDRESS").toLowerCase() ||
      adapter.toLowerCase() !== configuredAddress("ENS_ADAPTER_ADDRESS").toLowerCase() ||
      allocation[6] || allocation[1] < price || mandate[5] < price || spent + price > mandate[4] || humanAllocation[6] || humanAllocation[1] === 0n ||
      !mandate[9] || mandate[8] < block.timestamp + 86400n ||
      !await chain.readContract({ address: adapter, abi: ensPermissionAdapterAbi, functionName: "isAuthorized",
        args: [mandate[1], mandate[2], mandate[3], mandate[0]], blockNumber: block.number })) throw Error();
    return `Both allocations funded; ENS authority active; mandate expires ${new Date(Number(mandate[8]) * 1000).toISOString()}.`;
  }, "Inspect the demo allocations, signer, or ENS mandate. No renewal or funding was attempted."),
  check("Report seller and price", async () => {
    configuredAddress("RESEARCH_SELLER_ADDRESS");
    const price = process.env.RESEARCH_PRICE_BASE_UNITS ?? "1000000000000000000";
    if (!/^[1-9][0-9]{0,77}$/.test(price) || BigInt(price) >= 1n << 256n) throw Error();
    const token = configuredAddress("DEMO_TOKEN_ADDRESS");
    await chain.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
    return "Seller address, positive price, and demo asset metadata are configured.";
  }, "Set a valid public report seller, positive price, and readable token."),
  ...["DEPLOYER_PRIVATE_KEY", "DEMO_HUMAN_PRIVATE_KEY", "DEMO_AGENT_PRIVATE_KEY"].map((key) =>
    check(key.replace("_PRIVATE_KEY", " gas").toLowerCase(), async () => {
      const address = walletAddress(key);
      const balance = await chain.getBalance({ address });
      if (balance < 100_000_000_000_000n) throw Error();
      return `${address}: ${formatEther(balance)} Sepolia ETH. No funds moved.`;
    }, "Wallet configuration or gas balance needs attention; no funding was attempted.")),
]);
checks.push({ name: "WalletConnect", status: /^[0-9a-f]{32}$/i.test(process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "") ? "pass" : "fail",
  detail: "Reown project ID format checked; pairing is verified separately in Chrome." });
checks.push({ name: "World configuration", status: /^app_[0-9a-f]+$/i.test(process.env.WORLD_APP_ID ?? "") &&
  /^rp_[0-9a-f]+$/i.test(process.env.WORLD_RP_ID ?? "") && /^0x[0-9a-f]{64}$/i.test(process.env.WORLD_RP_SIGNING_KEY ?? "") &&
  ["staging", "production"].includes(process.env.WORLD_ENVIRONMENT ?? "") ? "pass" : "fail",
  detail: "Configuration format only. Run smoke:world-request to check request creation; an actual person must complete the proof." });
if (!process.env.INTERCEPTA_API_KEY?.trim()) checks.push({ name: "Intercepta", status: "waiting", detail: "API key is still pending. Payments remain blocked until screening succeeds." });
else await check("Intercepta", async () => {
  const result = await screenRecipient(configuredAddress("RESEARCH_SELLER_ADDRESS"));
  if (result.verdict !== "allow") throw Error();
  return "Live seller scan passed: zero toxic score and no reported risk traits. No payment was submitted.";
}, "Seller screening did not allow payment. Check key access, provider availability, or recipient risk; no funds moved.");
if (process.env.ACCORD_PARTNER_MOCKS || process.env.ACCORD_LOCAL_E2E === "1" || process.env.NEXT_PUBLIC_ACCORD_LOCAL_E2E === "1") {
  checks.push({ name: "Live mode", status: "fail", detail: "Remove local fixture settings before live testing." });
}
const report = { checkedAt: new Date().toISOString(), checks: checks.sort((a, b) => a.name.localeCompare(b.name)),
  manualEvidenceStillRequired: ["Real World App enrollment and fresh claim verification", "Live Intercepta allow/block demonstration", "Confirmed Sepolia report purchase"],
  transactionsSubmitted: 0 };
await mkdir(new URL("../../../.codex/", import.meta.url), { recursive: true });
await writeFile(new URL("../../../.codex/live-readiness.json", import.meta.url), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
for (const item of report.checks) console.log(`${item.status.toUpperCase().padEnd(7)} ${item.name}: ${item.detail}`);
console.log("No transactions submitted. Manual proof requirements are listed in .codex/live-readiness.json.");
process.exitCode = checks.some((item) => item.status === "fail") ? 1 : checks.some((item) => item.status === "waiting") ? 2 : 0;
