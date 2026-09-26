import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { HttpApiBuilder, HttpServer } from "@effect/platform";
import { Layer } from "effect";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { encodeFunctionData, getAddress, zeroAddress, type Hex } from "viem";
import { spaceAccountAbi, type SpacePermit } from "@accord/chain";
import { privateKeyToAccount } from "viem/accounts";
import { labelhash } from "viem/ens";
import { ApiLive } from "./app";
import { Database } from "./db";
import { agentConnections, agentPolicies, researchQuotes, sessions, spaceDrafts } from "./db/schema";
import { publicClient } from "./chain";
import { tokenHash } from "./auth";
import * as source from "./repository-research";
import * as sponsorWallet from "./sponsor-wallet";

const addr = (d: string) => getAddress(`0x${d.repeat(40)}`);
const agent = privateKeyToAccount(`0x${"0".repeat(63)}2`), owner = addr("1"), space = addr("3"), token = addr("4"), adapter = addr("5"), registry = addr("6"), seller = addr("7"), forwarder = addr("9");
const signerKey = `0x${"0".repeat(63)}1` as Hex;
const name = "research.team.accordspaces26.eth", grant = `0x${"d".repeat(64)}`;
const ownerToken = "a".repeat(64), setupToken = "b".repeat(64), scopedToken = "c".repeat(64);
let connection: ReturnType<typeof createClient>, db: ReturnType<typeof drizzle>, api: ReturnType<typeof HttpApiBuilder.toWebHandler>;
let draftId: string, ensActive: boolean, resource: bigint, resolved: string, expiry: bigint;
const expires = () => expiry;
beforeEach(async () => {
  expiry = BigInt(Math.floor(Date.now() / 1000) + 86400);
  draftId = randomUUID(); ensActive = true; resource = 2n; resolved = agent.address;
  for (const [key, value] of Object.entries({ PERMIT_SIGNER_PRIVATE_KEY: signerKey, ENS_ADAPTER_ADDRESS: adapter,
    SPACE_FACTORY_ADDRESS: addr("8"), DEMO_TOKEN_ADDRESS: token, FORWARDER_ADDRESS: forwarder,
    ENS_NAMESPACE_NAME: "accordspaces26.eth", ENSV2_REGISTRY_ADDRESS: addr("8"), RESEARCH_SELLER_ADDRESS: seller })) vi.stubEnv(key, value);
  vi.spyOn(publicClient, "getChainId").mockResolvedValue(11155111);
  vi.spyOn(publicClient, "getBlockNumber").mockResolvedValue(100n);
  vi.spyOn(publicClient, "getBlock").mockImplementation(async () => ({ number: 100n, timestamp: BigInt(Math.floor(Date.now() / 1000)) }) as never);
  vi.spyOn(publicClient, "getBytecode").mockResolvedValue("0x6000");
  vi.spyOn(publicClient, "simulateContract").mockResolvedValue({} as never);
  vi.spyOn(publicClient, "readContract").mockImplementation(async args => {
    const values: Record<string, unknown> = { owner, authorizer: privateKeyToAccount(signerKey).address, token, ensAdapter: adapter, trustedForwarder: forwarder,
      policyVersion: 1n, allocations: [zeroAddress, 100_000_000n, 100_000_000n, 0n, 0n, 0, false],
      mandates: [agent.address, registry, BigInt(labelhash("research")), 2n, 100_000_000n, 50_000_000n, 0n, 0n, expires(), true],
      isAuthorized: ensActive, getState: { status: ensActive ? 2 : 0, expiry: expires(), latestOwner: agent.address, tokenId: 1n, resource },
      getSubregistry: registry, getResolver: addr("a"), addr: resolved,
      consumedRequests: args.args?.[0] === grant, consumedNonces: false, nonces: 0n, verify: true };
    return values[args.functionName];
  });
  vi.spyOn(source, "repositoryReport").mockResolvedValue({ title: "Repository evidence", tier: "snapshot", merchant: "fixture",
    network: "Sepolia", currency: "tUSDC", collectedAt: new Date().toISOString(), cachePolicy: "fixture", criteria: [], repositories: [], usage: "fixture" });
  connection = createClient({ url: ":memory:" }); db = drizzle(connection);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle-sqlite", import.meta.url)) });
  await db.insert(sessions).values([
    { tokenHash: tokenHash(ownerToken), address: owner.toLowerCase(), expiresAt: new Date(Date.now() + 3600_000) },
    { tokenHash: tokenHash(setupToken), address: agent.address.toLowerCase(), kind: "agent_setup", expiresAt: new Date(Date.now() + 3600_000) },
  ]);
  await db.insert(spaceDrafts).values({ id: draftId, owner: owner.toLowerCase(), name: "Team", templateId: "research-budget", spaceAddress: space, tokenAddress: token, activatedAt: new Date() });
  await db.insert(agentPolicies).values({ requestId: randomUUID(), spaceAddress: space, allocationId: "1", name, agent: agent.address,
    registry, nameId: BigInt(labelhash("research")).toString(), resource: "2", dailyCap: "100000000", maxPerPayment: "50000000",
    approvalThreshold: "10000000", expiry: expires().toString(), permitRequestId: grant });
  api = HttpApiBuilder.toWebHandler(Layer.mergeAll(ApiLive.pipe(Layer.provide(Layer.succeed(Database, { client: db }))), HttpServer.layerContext));
});
afterEach(async () => { await api.dispose(); connection.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function post(path: string, payload: unknown, bearer = ownerToken) {
  return api.handler(new Request(`http://localhost${path}`, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify(payload) }));
}
function get(path: string, bearer = scopedToken) { return api.handler(new Request(`http://localhost${path}`, { headers: { authorization: `Bearer ${bearer}` } })); }
async function startPair() {
  const r = await post("/v1/toolkit/pair", { name }, setupToken); expect(r.status).toBe(200);
  const p = await r.json(); return { ...p, reviewToken: new URL(p.reviewUrl).hash.slice(1) };
}
async function paired() {
  const p = await startPair(), accept = await post("/v1/toolkit/pair/accept", { id: p.id, reviewToken: p.reviewToken, draftId, allocationId: "1" });
  expect(accept.status).toBe(200); const c = await accept.json();
  await db.insert(sessions).values({ tokenHash: tokenHash(scopedToken), address: agent.address.toLowerCase(), kind: "agent", connectionId: c.id, expiresAt: new Date(Date.now() + 3600_000) });
  return { p, c };
}
const input = () => ({ operationKey: randomUUID(), repositories: ["https://github.com/ensdomains/ens-contracts"], tier: "snapshot", criteria: [] });

describe("scoped agent connections", () => {
  it("rejects owner calldata and another Space at the relay boundary", async () => {
    await paired();
    const payload = { from: agent.address, to: space, value: "0", gas: "1500000", nonce: "0", deadline: String(Math.floor(Date.now() / 1000) + 300), signature: `0x${"0".repeat(130)}`,
      data: encodeFunctionData({ abi: spaceAccountAbi, functionName: "fundAllocation", args: [1n, 1n] }) };
    expect((await post("/v1/sponsor/relay", payload, scopedToken)).status).toBe(403);
    expect((await post("/v1/sponsor/relay", { ...payload, to: addr("b") }, scopedToken)).status).toBe(403);
  });
  it("returns one saved relay hash for concurrent retries of an exact quoted payment", async () => {
    await paired();
    const quote = await (await post("/v1/toolkit/quotes", input(), scopedToken)).json();
    const authorized = await post("/v1/permits/payments", { draftId, allocationId: "1", amount: quote.amount, recipient: quote.recipient, requestKey: quote.id }, scopedToken);
    expect(authorized.status).toBe(200);
    const authorization = await authorized.json(), p = authorization.permit;
    const permit: SpacePermit = { ...p, allocationId: BigInt(p.allocationId), amount: BigInt(p.amount), nonce: BigInt(p.nonce), expiry: BigInt(p.expiry), policyVersion: BigInt(p.policyVersion) };
    const transactionHash = `0x${"f".repeat(64)}`;
    const writeContract = vi.fn(async () => transactionHash);
    vi.spyOn(sponsorWallet, "sponsor").mockReturnValue({ account: { address: seller }, writeContract } as never);
    vi.spyOn(sponsorWallet, "fundedFees").mockResolvedValue({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n });
    vi.spyOn(publicClient, "estimateContractGas").mockResolvedValue(100_000n);
    const payload = { from: agent.address, to: space, value: "0", gas: "1500000", nonce: "0", deadline: String(Math.floor(Date.now() / 1000) + 300), signature: `0x${"0".repeat(130)}`,
      data: encodeFunctionData({ abi: spaceAccountAbi, functionName: "pay", args: [1n, seller, BigInt(quote.amount), permit, authorization.signature] }) };
    const responses = await Promise.all([post("/v1/sponsor/relay", payload, scopedToken), post("/v1/sponsor/relay", payload, scopedToken)]);
    for (const response of responses) { expect(response.status).toBe(200); expect(await response.json()).toEqual({ transactionHash }); }
    expect(writeContract).toHaveBeenCalledTimes(1);
  });
  it("resolves a real-shaped ENS hierarchy into its exact Space and budget", async () => {
    const r = await post("/v1/toolkit/resolve", { name }); expect(r.status).toBe(200);
    const { identities } = await r.json(); expect(identities).toHaveLength(1);
    expect(identities[0]).toMatchObject({ name, agent: agent.address, spaceAddress: space, allocationId: "1", remaining: "100000000", active: true });
    expect(vi.mocked(publicClient.readContract).mock.calls.every(([call]) => call.blockNumber === 100n)).toBe(true);
  });
  it("rejects wrong network, changed registration and mismatched resolver", async () => {
    vi.mocked(publicClient.getChainId).mockResolvedValueOnce(84532);
    expect((await post("/v1/toolkit/resolve", { name })).status).toBe(400);
    resource = 3n; expect((await post("/v1/toolkit/resolve", { name })).status).toBe(400);
    resource = 2n; resolved = owner; expect((await post("/v1/toolkit/resolve", { name })).status).toBe(400);
  });
  it("requires explicit owner acceptance and consumes pairing once", async () => {
    const { p, c } = await paired();
    const poll = await post("/v1/toolkit/pair/poll", { id: p.id, pollToken: p.pollToken }, setupToken);
    expect((await poll.json()).connectionId).toBe(c.id);
    expect((await post("/v1/toolkit/pair/accept", { id: p.id, reviewToken: p.reviewToken, draftId, allocationId: "1" })).status).toBe(400);
    expect((await get("/v1/toolkit/identity")).status).toBe(200);
  });
  it("cannot swap a pairing's secret, Space or signer", async () => {
    const p = await startPair();
    expect((await post("/v1/toolkit/pair/review", { id: p.id, reviewToken: "f".repeat(64) })).status).toBe(400);
    expect((await post("/v1/toolkit/pair/accept", { id: p.id, reviewToken: p.reviewToken, draftId: randomUUID(), allocationId: "1" })).status).toBe(400);
    await db.update(spaceDrafts).set({ owner: agent.address.toLowerCase() });
    expect((await post("/v1/toolkit/pair/accept", { id: p.id, reviewToken: p.reviewToken, draftId, allocationId: "1" })).status).toBe(400);
    expect(await db.select().from(agentConnections)).toHaveLength(0);
  });
  it("generic agent sign-in creates setup credentials, and scoped reauthentication needs the matching key", async () => {
    const { c } = await paired();
    const challenge = await (await post("/v1/auth/challenge", { address: agent.address })).json();
    const signature = await agent.signMessage({ message: challenge.message });
    const verified = await post("/v1/auth/verify", { id: challenge.id, address: agent.address, signature, client: "agent" });
    expect(verified.status).toBe(200); const result = await verified.json();
    expect((await get("/v1/toolkit/identity", result.token)).status).toBe(403);
    const next = await (await post("/v1/auth/challenge", { address: agent.address })).json();
    const signed = await agent.signMessage({ message: next.message });
    const connected = await post("/v1/auth/verify", { id: next.id, address: agent.address, signature: signed, client: "agent", connectionId: c.id });
    expect(connected.status).toBe(200);
    expect((await get("/v1/toolkit/identity", (await connected.json()).token)).status).toBe(200);
  });
  it.each(["/v1/spaces/drafts", "/v1/approvals/world/start", "/v1/approvals/decide", "/v1/admin/allocations/recover", "/v1/agents/fund", "/v1/world/unlink", "/v1/sponsor/faucet"])("agent credentials cannot access owner or beneficiary route %s", async path => {
    await paired();
    const body = { id: randomUUID(), draftId, name: "Other", templateId: "research-budget", decision: "approve", requestKey: randomUUID(), allocationId: "1", amount: "1000000" };
    expect((await post(path, body, scopedToken)).status).toBe(403);
  });
  it("rejects spending outside its connected allocation", async () => {
    await paired();
    expect((await post("/v1/permits/payments", { draftId, allocationId: "2", amount: "1000000", recipient: seller, requestKey: randomUUID() }, scopedToken)).status).toBe(403);
  });
  it("disconnect revokes existing tokens and future renewal", async () => {
    const { c } = await paired(); expect((await post("/v1/toolkit/disconnect", { id: c.id })).status).toBe(200);
    expect((await get("/v1/toolkit/identity")).status).toBe(401);
    const challenge = await (await post("/v1/auth/challenge", { address: agent.address })).json();
    expect((await post("/v1/auth/verify", { id: challenge.id, address: agent.address, signature: await agent.signMessage({ message: challenge.message }), client: "agent", connectionId: c.id })).status).toBe(403);
  });
  it("quotes are idempotent and altered input cannot reuse an operation key", async () => {
    await paired(); const payload = input();
    const a = await post("/v1/toolkit/quotes", payload, scopedToken), b = await post("/v1/toolkit/quotes", payload, scopedToken);
    expect(a.status).toBe(200); expect(await a.json()).toEqual(await b.json());
    expect(source.repositoryReport).toHaveBeenCalledTimes(1);
    expect((await post("/v1/toolkit/quotes", { ...payload, tier: "comparison" }, scopedToken)).status).toBe(400);
    expect(await db.select().from(researchQuotes)).toHaveLength(1);
  });
  it("rejects new work after ENS revocation and keeps unpaid research private", async () => {
    await paired(); const q = await (await post("/v1/toolkit/quotes", input(), scopedToken)).json();
    const status = await post("/v1/toolkit/operation", { id: q.id }, scopedToken);
    expect(status.status).toBe(200); expect((await status.json()).result).toBeUndefined();
    ensActive = false;
    expect((await post("/v1/toolkit/quotes", input(), scopedToken)).status).toBe(400);
    expect((await post("/v1/permits/payments", { draftId, allocationId: "1", amount: q.amount, recipient: q.recipient, requestKey: q.id }, scopedToken)).status).toBe(403);
  });
});
