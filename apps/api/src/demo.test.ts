import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { HttpApiBuilder, HttpServer } from "@effect/platform";
import { Layer } from "effect";
import { ContractFunctionRevertedError, encodeAbiParameters, encodeErrorResult, encodeEventTopics, encodeFunctionData, erc20Abi, keccak256, toBytes, zeroAddress, zeroHash, type Hex } from "viem";
import { spaceAccountAbi } from "@accord/chain";
import { ApiLive } from "./app";
import { Database } from "./db";
import { agentPolicies, agentRequests, permitIntents, researchQuotes, sessions } from "./db/schema";
import { publicClient } from "./chain";
import { demoEvidence, readDemoEvidence } from "./demo";
import { demoManifest as m } from "./demo-manifest";
import { ensRegistryAbi } from "./ens-v2";

let connection: ReturnType<typeof createClient>, db: ReturnType<typeof drizzle>;
let api: ReturnType<typeof HttpApiBuilder.toWebHandler>;
const requestId = (id: string) => keccak256(toBytes(id));
const expiry = new Date(1790401038_000), verifiedAt = new Date(1790400897_000);
const privateMarker = "DO_NOT_PUBLISH_PRIVATE_IDENTITY";
beforeEach(async () => {
  connection = createClient({ url: ":memory:" }); db = drizzle(connection);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle-sqlite", import.meta.url)) });
  const base = { owner: m.owner, actor: m.agent.toLowerCase(), draftId: "demo-draft", spaceAddress: m.spaceAddress,
    allocationId: "2", payload: JSON.stringify({ amount: "20000000", recipient: m.seller }), policyVersion: "1", expiresAt: expiry, createdAt: new Date(1790400759_000) };
  await db.insert(agentRequests).values({ ...base, id: "grant", kind: "grant", requestKey: "grant", status: "issued", verifiedAt, identityId: privateMarker });
  await db.insert(agentPolicies).values({ requestId: "grant", spaceAddress: m.spaceAddress, allocationId: "2", name: m.agentName,
    agent: m.agent, registry: m.registry, nameId: m.nameId, resource: m.resource, dailyCap: "100000000", maxPerPayment: "25000000",
    approvalThreshold: "10000000", expiry: "1900000000", permitRequestId: zeroHash });
  for (const kind of ["approved", "denied", "revoked"] as const) {
    const id = m[kind].quoteId;
    await db.insert(researchQuotes).values({ id, actor: m.agent.toLowerCase(), draftId: "demo-draft", allocationId: "2", spaceAddress: m.spaceAddress,
      tokenAddress: m.token, recipient: m.seller, amount: "20000000", expiresAt: expiry, service: "repository-research",
      connectionId: privateMarker, operationKey: kind, transactionHash: kind === "approved" ? m.approved.tx : null,
      terms: JSON.stringify({ agentName: m.agentName, repositories: ["wevm/viem"], criteria: ["TypeScript"], blockNumber: "800", private: privateMarker }),
      result: JSON.stringify({ collectedAt: verifiedAt.toISOString(), private: privateMarker, repositories: [{ repository: "wevm/viem", url: "https://github.com/wevm/viem",
        description: "Ethereum library", license: "MIT", maintenance: { commitsObserved: 10, truncated: false, coverage: "90 days" },
        sources: ["https://github.com/wevm/viem", "javascript:alert(1)", "https://github.com.evil.test/secret"], private: privateMarker }] }) });
    await db.insert(agentRequests).values({ ...base, id: kind, kind: "payment", requestKey: id, status: kind === "denied" ? "denied" : "issued",
      verifiedAt: kind === "denied" ? null : verifiedAt, identityId: privateMarker, verificationSession: privateMarker,
      envelope: privateMarker, permitIntentId: kind === "denied" ? null : kind });
  }
  await db.insert(permitIntents).values({ id: "revoked", requestKey: m.revoked.quoteId, draftId: "demo-draft", spaceAddress: m.spaceAddress,
    actor: m.agent.toLowerCase(), action: "pay", allocationId: "2", recipient: m.seller, amount: "20000000", requestId: requestId(m.revoked.quoteId),
    nonce: "0", expiry, policyVersion: "1", permitDigest: zeroHash, signature: `0x${"ab".repeat(65)}`, signedAt: verifiedAt });
  vi.spyOn(publicClient, "getChainId").mockResolvedValue(11155111);
  vi.spyOn(publicClient, "getBlock").mockImplementation(async args => ({ number: args?.blockNumber ?? 1000n, hash: zeroHash, timestamp: 1790400924n }) as never);
  vi.spyOn(publicClient, "readContract").mockImplementation(async args => {
    if (args.functionName === "isAuthorized") return args.blockNumber === 800n;
    if (args.functionName === "consumedRequests") return args.args?.[0] === requestId(m.approved.quoteId);
    if (args.functionName === "allocations") return [zeroAddress, 79_000_000n, 100_000_000n, 0n, 0n, 0, false];
    if (args.functionName === "mandates") return [m.agent, m.registry, BigInt(m.nameId), BigInt(m.resource), 100_000_000n, 25_000_000n, 0n, 0n, 1900000000n, true];
    throw new Error("Unexpected read");
  });
  vi.spyOn(publicClient, "getTransactionReceipt").mockImplementation(async args => ({ status: "success", blockHash: zeroHash,
    blockNumber: args.hash === m.revoked.tx ? 900n : 100n, logs: args.hash === m.revoked.tx ? [] : [
      { address: m.spaceAddress, topics: encodeEventTopics({ abi: spaceAccountAbi, eventName: "PaymentMade", args: { requestId: requestId(m.approved.quoteId), allocationId: 2n, agent: m.agent } }), data: encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [m.seller, 20_000_000n]) },
      { address: m.token, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: m.spaceAddress, to: m.seller } }), data: encodeAbiParameters([{ type: "uint256" }], [20_000_000n]) },
    ] }) as never);
  vi.spyOn(publicClient, "getTransaction").mockResolvedValue({ to: m.registry, input: encodeFunctionData({ abi: ensRegistryAbi, functionName: "unregister", args: [BigInt(m.nameId)] }) } as never);
  vi.spyOn(publicClient, "simulateContract").mockImplementation(async args => {
    if (args.blockNumber === 899n) return {} as never;
    throw new ContractFunctionRevertedError({ abi: spaceAccountAbi, functionName: "pay", data: encodeErrorResult({ abi: spaceAccountAbi, errorName: "InvalidEnsAuthority" }) });
  });
  api = HttpApiBuilder.toWebHandler(Layer.mergeAll(ApiLive.pipe(Layer.provide(Layer.succeed(Database, { client: db }))), HttpServer.layerContext));
});
afterEach(async () => { await api.dispose(); connection.close(); vi.restoreAllMocks(); });

describe("published demo evidence", () => {
  it("is public, verifies exact receipts and replays the historical permit without exposing private records", async () => {
    const response = await api.handler(new Request("http://localhost/v1/demo/evidence"));
    expect(response.status).toBe(200); const data = await response.json();
    expect(data.cases).toHaveLength(3);
    expect(data.cases.flatMap((c: { checks: { status: string }[] }) => c.checks).every((c: { status: string }) => c.status === "passed")).toBe(true);
    expect(data.identity).toEqual({ status: "inactive", remaining: "79000000" });
    expect(data.cases[0].report.repositories[0].sources).toEqual(["https://github.com/wevm/viem"]);
    expect(data.cases[1].report).toBeNull(); expect(data.cases[2].report).toBeNull();
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain(privateMarker); expect(serialized).not.toContain("ab".repeat(65));
    expect(vi.mocked(publicClient.simulateContract).mock.calls.map(([args]) => args.blockNumber)).toEqual([899n, 900n]);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
  it("never lets a caller select another user's quote", async () => {
    const response = await api.handler(new Request("http://localhost/v1/demo/evidence?quoteId=private-report&spaceAddress=other"));
    expect((await response.json()).cases.map((c: { quoteId: string }) => c.quoteId)).toEqual([m.approved.quoteId, m.denied.quoteId, m.revoked.quoteId]);
  });
  it("rejects a changed published recipient and withholds the artifact", async () => {
    await db.update(researchQuotes).set({ recipient: zeroAddress }).where(eq(researchQuotes.id, m.approved.quoteId));
    const run = (await readDemoEvidence(db)).cases[0]!;
    expect(run.checks[0]?.status).toBe("failed"); expect(run.report).toBeNull();
  });
  it("does not present a different World identity as same-owner approval", async () => {
    await db.update(agentRequests).set({ identityId: "different-person" }).where(eq(agentRequests.id, "approved"));
    const run = (await readDemoEvidence(db)).cases[0]!;
    expect(run.checks.find(c => c.label === "Verified owner approved")?.status).toBe("failed"); expect(run.report).toBeNull();
  });
  it("rejects a successful receipt that lacks the exact payment and token transfer", async () => {
    vi.mocked(publicClient.getTransactionReceipt).mockResolvedValue({ status: "success", blockNumber: 100n, blockHash: zeroHash, logs: [] } as never);
    const run = (await readDemoEvidence(db)).cases[0]!;
    expect(run.checks.find(c => c.source === "Sepolia")?.status).toBe("failed"); expect(run.report).toBeNull();
  });
  it("flags a denied request as inconsistent if its payment was consumed", async () => {
    const read = publicClient.readContract;
    vi.mocked(read).mockImplementation(async args => args.functionName === "consumedRequests" ? true : args.functionName === "isAuthorized" ? false : [] as never);
    const run = (await readDemoEvidence(db)).cases[1]!;
    expect(run.checks.find(c => c.label === "Payment request remains unused")?.status).toBe("failed");
  });
  it("shows unavailability rather than success during an RPC failure, without leaking its URL", async () => {
    vi.mocked(publicClient.getChainId).mockRejectedValue(new Error("https://private-rpc/key-SECRET"));
    const data = await readDemoEvidence(db);
    expect(data.identity.status).toBe("unavailable"); expect(data.cases[0]!.report).toBeNull();
    expect(data.cases[0]!.checks.find(c => c.source === "Sepolia")?.status).toBe("unavailable");
    expect(JSON.stringify(data)).not.toContain("SECRET");
  });
  it("does not claim ENS caused rejection if the cached permit had already expired", async () => {
    await db.update(permitIntents).set({ expiry: new Date(1790400900_000) }).where(eq(permitIntents.id, "revoked"));
    const run = (await readDemoEvidence(db)).cases[2]!;
    expect(run.checks.find(c => c.source === "Historical simulation")?.status).toBe("failed");
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
  });
  it("keeps archive read failures distinct from verified revocation receipts", async () => {
    vi.mocked(publicClient.simulateContract).mockRejectedValue(new Error("Archive unavailable"));
    const run = (await readDemoEvidence(db)).cases[2]!;
    expect(run.checks.find(c => c.label === "ENS revocation confirmed")?.status).toBe("passed");
    expect(run.checks.find(c => c.source === "Historical simulation")?.status).toBe("unavailable");
  });
  it("shares concurrent checks and caches public RPC work", async () => {
    const first = demoEvidence(db), second = demoEvidence(db);
    expect(second).toBe(first); await first;
    expect(demoEvidence(db)).toBe(first);
    expect(publicClient.getChainId).toHaveBeenCalledTimes(1);
  });
});
