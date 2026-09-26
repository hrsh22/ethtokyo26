import { AccordApi, type PublicDemoEvidence } from "@accord/api-contract";
import { ensPermissionAdapterAbi, spaceAccountAbi, type SpacePermit } from "@accord/chain";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { and, eq } from "drizzle-orm";
import { BaseError, ContractFunctionRevertedError, decodeFunctionData, getAddress, keccak256, toBytes, type Hex } from "viem";
import { publicClient } from "./chain";
import { Database, type DatabaseClient } from "./db";
import { agentPolicies, agentRequests, agentSubmissions, permitIntents, researchQuotes } from "./db/schema";
import { demoManifest as manifest } from "./demo-manifest";
import { ensRegistryAbi } from "./ens-v2";
import { matchesResearchPayment } from "./research-receipt";

type Check = PublicDemoEvidence["cases"][number]["checks"][number];
type Quote = typeof researchQuotes.$inferSelect;
class Mismatch extends Error {}
function requireMatch(value: unknown): asserts value { if (!value) throw new Mismatch(); }
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const iso = (date: Date | null | undefined) => date?.toISOString() ?? null;
const strings = (value: unknown, max = 3): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, max).map(v => v.slice(0, 200)) : [];
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max = 500) => typeof value === "string" ? value.slice(0, max) : "";
function githubUrl(value: unknown) {
  try { const u = new URL(text(value, 1000)); return u.protocol === "https:" && u.hostname === "github.com" && !u.username && !u.password ? u.href : null; }
  catch { return null; }
}
function publishedReport(q: Quote): NonNullable<PublicDemoEvidence["cases"][number]["report"]> {
  const report = object(JSON.parse(q.result!));
  requireMatch(Array.isArray(report.repositories) && typeof report.collectedAt === "string");
  return { collectedAt: report.collectedAt, repositories: report.repositories.slice(0, 3).map(value => {
    const repo = object(value), maintenance = object(repo.maintenance), url = githubUrl(repo.url);
    requireMatch(url && ["ensdomains/ens-contracts", "wevm/viem", "modelcontextprotocol/typescript-sdk"].includes(text(repo.repository)));
    return { name: text(repo.repository), url, description: text(repo.description) || null,
      license: text(repo.license, 100), commits: typeof maintenance.commitsObserved === "number" ? maintenance.commitsObserved : null,
      truncated: maintenance.truncated === true, coverage: text(maintenance.coverage),
      sources: strings(repo.sources, 5).map(githubUrl).filter((s): s is string => !!s) };
  }) };
}
async function check(label: string, source: Check["source"], work: () => Promise<string>): Promise<Check> {
  try { return { label, source, status: "passed", detail: await work() }; }
  catch (error) { return { label, source, status: error instanceof Mismatch ? "failed" : "unavailable",
    detail: error instanceof Mismatch ? "The evidence does not match the published run." : "This check could not be completed. Try again shortly." }; }
}

// A fixed, read-only publication. No arbitrary IDs, authentication data, signatures,
// wallet keys, private reports or writes are exposed through this endpoint.
export async function readDemoEvidence(db: DatabaseClient): Promise<PublicDemoEvidence> {
  let block: { number: bigint; timestamp: bigint } | undefined;
  try {
    requireMatch(await publicClient.getChainId() === 11155111);
    const latest = await publicClient.getBlock(); requireMatch(latest.number !== null);
    block = { number: latest.number, timestamp: latest.timestamp };
  } catch { /* Checks report unavailable. */ }
  const at = { address: manifest.spaceAddress, abi: spaceAccountAbi, blockNumber: block?.number } as const;
  async function consumed(id: string) {
    if (!block) throw new Error();
    return publicClient.readContract({ ...at, functionName: "consumedRequests", args: [keccak256(toBytes(id))] });
  }
  const identity: { status: "active" | "inactive" | "unavailable"; remaining: string | null } = { status: "unavailable", remaining: null };
  const identityWork = (async () => {
    try {
      if (!block) return;
      const [authorized, allocation, mandate] = await Promise.all([
        publicClient.readContract({ address: manifest.adapter, abi: ensPermissionAdapterAbi, functionName: "isAuthorized",
          args: [manifest.registry, BigInt(manifest.nameId), BigInt(manifest.resource), manifest.agent], blockNumber: block.number }),
        publicClient.readContract({ ...at, functionName: "allocations", args: [2n] }),
        publicClient.readContract({ ...at, functionName: "mandates", args: [2n] }),
      ]);
      requireMatch(same(mandate[0], manifest.agent) && same(mandate[1], manifest.registry) && mandate[2].toString() === manifest.nameId && mandate[3].toString() === manifest.resource);
      identity.status = authorized && mandate[9] && mandate[8] > block.timestamp && !allocation[6] ? "active" : "inactive";
      identity.remaining = allocation[1].toString();
    } catch { /* No inferred state when a read fails. */ }
  })();
  const cases = await Promise.all((["approved", "denied", "revoked"] as const).map(async id => {
    const item = manifest[id], checks: Check[] = [];
    const entry: { id: typeof id; quoteId: string; amount: string; recipient: string | null; createdAt: string | null;
      repositories: string[]; criteria: string[]; transactionHash: string | null; checks: Check[];
      report: PublicDemoEvidence["cases"][number]["report"] } = {
      id, quoteId: item.quoteId, amount: "20000000", recipient: null, createdAt: null, repositories: [], criteria: [],
      transactionHash: "tx" in item ? item.tx : null, checks, report: null,
    };
    let quote: Quote | undefined;
    checks.push(await check("Published purchase", "Accord record", async () => {
      const [q] = await db.select().from(researchQuotes).where(eq(researchQuotes.id, item.quoteId));
      requireMatch(q && same(q.actor, manifest.agent) && same(q.spaceAddress, manifest.spaceAddress) && q.allocationId === manifest.allocationId &&
        same(q.tokenAddress, manifest.token) && same(q.recipient, manifest.seller) && q.amount === "20000000" && q.service === "repository-research");
      const terms = object(JSON.parse(q.terms!)); requireMatch(terms.agentName === manifest.agentName);
      quote = q; entry.recipient = getAddress(q.recipient); entry.createdAt = iso(q.createdAt);
      entry.repositories = strings(terms.repositories); entry.criteria = strings(terms.criteria);
      return "The saved request matches this agent, Space, token, recipient and amount.";
    }));
    if (!quote) return entry;
    const q = quote;
    let approval: typeof agentRequests.$inferSelect | undefined;
    checks.push(await check(id === "denied" ? "Owner denied the request" : "Verified owner approved", "Accord record", async () => {
      const [request] = await db.select().from(agentRequests).where(and(eq(agentRequests.requestKey, q.id), eq(agentRequests.actor, q.actor)));
      requireMatch(request && request.kind === "payment" && same(request.owner, manifest.owner) && same(request.spaceAddress, q.spaceAddress) && request.allocationId === q.allocationId);
      const terms = object(JSON.parse(request.payload));
      requireMatch(terms.amount === q.amount && typeof terms.recipient === "string" && same(terms.recipient, q.recipient));
      if (id === "denied") {
        requireMatch(request.status === "denied" && !request.permitIntentId);
        return "Accord recorded the owner's denial and issued no payment permit for this request.";
      }
      requireMatch(request.status === "issued" && request.verifiedAt && request.identityId && request.permitIntentId &&
        request.verifiedAt >= request.createdAt && request.verifiedAt < request.expiresAt);
      const [policy] = await db.select().from(agentPolicies).where(and(eq(agentPolicies.spaceAddress, q.spaceAddress), eq(agentPolicies.allocationId, q.allocationId), eq(agentPolicies.resource, manifest.resource)));
      const [grant] = policy ? await db.select().from(agentRequests).where(eq(agentRequests.id, policy.requestId)) : [];
      requireMatch(grant?.verifiedAt && grant.identityId === request.identityId && same(grant.owner, request.owner));
      approval = request;
      return `Accord recorded fresh World sandbox verification at ${request.verifiedAt.toISOString()} by the same identity used for delegation, followed by approval.`;
    }));
    if (id === "approved") {
      checks.push(await check("Exact payment confirmed", "Sepolia", async () => {
        if (!block) throw new Error();
        requireMatch(q.transactionHash === manifest.approved.tx);
        const receipt = await publicClient.getTransactionReceipt({ hash: manifest.approved.tx });
        const canonical = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
        requireMatch(receipt.blockHash === canonical.hash && receipt.blockNumber <= block.number && matchesResearchPayment(receipt, q) &&
          canonical.timestamp <= BigInt(Math.floor(q.expiresAt.getTime() / 1000)) && await consumed(q.id));
        return `Confirmed at block ${receipt.blockNumber}: the Space payment and tUSDC transfer match this exact request.`;
      }));
      if (checks.every(c => c.status === "passed")) {
        checks.push(await check("Purchased research delivered", "Accord record", async () => {
          entry.report = publishedReport(q);
          return "The immutable report is saved for this exact paid quote.";
        }));
      }
    } else {
      if (id === "denied") checks.push(await check("ENS was active for this request", "Sepolia", async () => {
        if (!block) throw new Error();
        const terms = object(JSON.parse(q.terms!));
        requireMatch(typeof terms.blockNumber === "string" && /^\d+$/.test(terms.blockNumber) && BigInt(terms.blockNumber) <= block.number);
        const active = await publicClient.readContract({ address: manifest.adapter, abi: ensPermissionAdapterAbi, functionName: "isAuthorized",
          args: [manifest.registry, BigInt(manifest.nameId), BigInt(manifest.resource), manifest.agent], blockNumber: BigInt(terms.blockNumber) });
        requireMatch(active);
        return `The ENS adapter reports valid authority at the quote's recorded block ${terms.blockNumber}.`;
      }));
      checks.push(await check("Payment request remains unused", "Sepolia", async () => {
        const [submission] = await db.select({ hash: agentSubmissions.transactionHash }).from(agentSubmissions).where(eq(agentSubmissions.requestId, keccak256(toBytes(q.id))));
        requireMatch(!q.transactionHash && !submission && !await consumed(q.id));
        return `The contract reports this request unconsumed at block ${block!.number}; Accord has no submitted payment recorded.`;
      }));
    }
    if (id === "revoked") {
      let revocationBlock: bigint | undefined;
      checks.push(await check("ENS revocation confirmed", "Sepolia", async () => {
        if (!block) throw new Error();
        const [receipt, tx] = await Promise.all([
          publicClient.getTransactionReceipt({ hash: manifest.revoked.tx }), publicClient.getTransaction({ hash: manifest.revoked.tx }),
        ]);
        const canonical = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
        requireMatch(receipt.status === "success" && receipt.blockHash === canonical.hash && receipt.blockNumber <= block.number && tx.to && same(tx.to, manifest.registry));
        const decoded = decodeFunctionData({ abi: ensRegistryAbi, data: tx.input });
        requireMatch(decoded.functionName === "unregister" && decoded.args?.[0] === BigInt(manifest.nameId));
        revocationBlock = receipt.blockNumber;
        return `The agent's ENS registration was unregistered at block ${receipt.blockNumber}.`;
      }));
      checks.push(await check("Cached permit blocked after revocation", "Historical simulation", async () => {
        if (!revocationBlock || !approval?.permitIntentId) throw new Error();
        const [p] = await db.select().from(permitIntents).where(eq(permitIntents.id, approval.permitIntentId));
        requireMatch(p?.signature && p.action === "pay" && p.requestKey === q.id && p.requestId === keccak256(toBytes(q.id)) &&
          same(p.spaceAddress, q.spaceAddress) && same(p.actor, q.actor) && p.allocationId === q.allocationId && same(p.recipient, q.recipient) && p.amount === q.amount);
        const historical = await publicClient.getBlock({ blockNumber: revocationBlock });
        const expiry = BigInt(Math.floor(p.expiry.getTime() / 1000));
        requireMatch(historical.timestamp < expiry);
        const permit: SpacePermit = { actor: getAddress(p.actor), action: 3, allocationId: BigInt(p.allocationId),
          recipient: getAddress(p.recipient), amount: BigInt(p.amount), requestId: p.requestId as Hex, nonce: BigInt(p.nonce),
          expiry, policyVersion: BigInt(p.policyVersion), detailsHash: `0x${"0".repeat(64)}` };
        const args = { address: manifest.spaceAddress, abi: spaceAccountAbi, functionName: "pay" as const,
          args: [2n, manifest.seller, BigInt(q.amount), permit, p.signature as Hex] as const, account: manifest.agent };
        await publicClient.simulateContract({ ...args, blockNumber: revocationBlock - 1n });
        try { await publicClient.simulateContract({ ...args, blockNumber: revocationBlock }); }
        catch (error) {
          const cause = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : undefined;
          if (!(cause instanceof ContractFunctionRevertedError)) throw error;
          requireMatch(cause.data?.errorName === "InvalidEnsAuthority");
          return `The same signed payment passes at block ${revocationBlock - 1n} and fails with InvalidEnsAuthority at ${revocationBlock}, with ${expiry - historical.timestamp}s left on its permit. Read-only replay; no transaction is broadcast.`;
        }
        throw new Mismatch();
      }));
    }
    return entry;
  }));
  await identityWork;
  return { checkedAt: new Date().toISOString(), blockNumber: block?.number.toString() ?? null, chainId: 11155111,
    spaceAddress: manifest.spaceAddress, spaceName: manifest.spaceName, allocationId: manifest.allocationId, agentName: manifest.agentName, identity, cases };
}

// Bound public RPC work: one shared in-flight check per database, cached for 45s.
const cache = new WeakMap<DatabaseClient, { until: number; promise: Promise<PublicDemoEvidence> }>();
export function demoEvidence(db: DatabaseClient) {
  const saved = cache.get(db); if (saved && saved.until > Date.now()) return saved.promise;
  const promise = readDemoEvidence(db); const entry = { until: Infinity, promise }; cache.set(db, entry);
  void promise.then(() => { entry.until = Date.now() + 45_000; }, () => { cache.delete(db); });
  return promise;
}
export const DemoLive = HttpApiBuilder.group(AccordApi, "demo", handlers => handlers.handle("evidence", () =>
  Effect.gen(function* () { const db = yield* Database; return yield* Effect.promise(() => demoEvidence(db.client)); })));
