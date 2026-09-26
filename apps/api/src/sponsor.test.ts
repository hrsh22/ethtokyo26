import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { HttpApiBuilder, HttpServer } from "@effect/platform";
import { Layer } from "effect";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { decodeFunctionData, encodeFunctionData, getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { accordForwarderAbi, accordTestUSDCAbi, spaceAccountAbi, spaceNamespaceAbi, namedSpaceFactoryAbi } from "@accord/chain";
import { spaceFactoryAbi } from "@accord/chain";
import { ApiLive } from "./app";
import { publicClient } from "./chain";
import { Database } from "./db";
import { sessions, spaceDrafts, spaceNamespaces } from "./db/schema";
import * as sponsorWallet from "./sponsor-wallet";

const address = (n: string) => getAddress(`0x${n.repeat(40)}`);
const owner = address("1"), factory = address("2"), token = address("3"), adapter = address("4");
const forwarder = address("5"), sponsor = address("6");
const key = `0x${"0".repeat(63)}1` as Hex, authorizer = privateKeyToAccount(key).address;
const bearer = "a".repeat(64), transactionHash = `0x${"b".repeat(64)}` as Hex;
const fees = { maxFeePerGas: 1_200_000_000n, maxPriorityFeePerGas: 1_000_000n };
let connection: ReturnType<typeof createClient>, api: ReturnType<typeof HttpApiBuilder.toWebHandler>;
const writeContract = vi.fn();
let database: ReturnType<typeof drizzle>;

beforeEach(async () => {
  vi.stubEnv("PERMIT_SIGNER_PRIVATE_KEY", key);
  vi.stubEnv("SPACE_FACTORY_ADDRESS", factory);
  vi.stubEnv("DEMO_TOKEN_ADDRESS", token);
  vi.stubEnv("ENS_ADAPTER_ADDRESS", adapter);
  vi.stubEnv("FORWARDER_ADDRESS", forwarder);
  vi.stubEnv("SPONSOR_MIN_BALANCE_WEI", "1000000000000000");
  writeContract.mockReset().mockResolvedValue(transactionHash);
  vi.spyOn(sponsorWallet, "sponsor").mockReturnValue({ account: { address: sponsor }, writeContract } as never);
  vi.spyOn(publicClient, "readContract").mockImplementation(async (args) => args.functionName === "nonces" ? 0n : true);
  vi.spyOn(publicClient, "simulateContract").mockImplementation(async (args) => ({ request: args }) as never);
  vi.spyOn(publicClient, "estimateContractGas").mockResolvedValue(2_800_000n);
  vi.spyOn(publicClient, "estimateFeesPerGas").mockResolvedValue(fees);
  vi.spyOn(publicClient, "getBalance").mockResolvedValue(6_900_000_000_000_000n);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  connection = createClient({ url: ":memory:" });
  const db = drizzle(connection);
  database = db;
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle-sqlite", import.meta.url)) });
  await db.insert(sessions).values({ tokenHash: createHash("sha256").update(bearer).digest("hex"),
    address: owner.toLowerCase(), expiresAt: new Date(Date.now() + 60_000) });
  await db.insert(spaceDrafts).values({ id: randomUUID(), owner: owner.toLowerCase(), name: "Savings", templateId: "recurring-support" });
  api = HttpApiBuilder.toWebHandler(Layer.mergeAll(ApiLive.pipe(Layer.provide(Layer.succeed(Database, { client: db }))), HttpServer.layerContext));
});
afterEach(async () => { await api.dispose(); connection.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function post(path: string, payload: unknown) {
  return api.handler(new Request(`http://localhost${path}`, { method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify(payload) }));
}
function relay() {
  return post("/v1/sponsor/relay", { from: owner, to: factory, value: "0", gas: "7500000", nonce: "0",
    deadline: String(Math.floor(Date.now() / 1000) + 300), signature: `0x${"0".repeat(130)}`,
    data: encodeFunctionData({ abi: spaceFactoryAbi, functionName: "createSpace", args: [authorizer, token, adapter] }) });
}

describe("Space deployment sponsorship", () => {
  it("reports the actual low sponsor balance and never broadcasts", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValue(3_200_000_000_000_000n);
    const response = await relay();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ _tag: "SponsorUnavailable", reason: "insufficient_balance" });
    expect(writeContract).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"requiredWei":"5200000000000000"'));
  });

  it("submits after replenishment using estimated execution gas and the checked fee caps", async () => {
    const response = await relay();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transactionHash });
    expect(writeContract).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ gas: 3_500_000n, ...fees }));
    expect(publicClient.estimateFeesPerGas).toHaveBeenCalledTimes(1);
    expect(publicClient.getBalance).toHaveBeenCalledWith({ address: sponsor, blockTag: "pending" });
  });

  it("also identifies an unfunded faucet", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValue(1n);
    const response = await post("/v1/sponsor/faucet", {});
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ _tag: "SponsorUnavailable", reason: "insufficient_balance" });
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("does not expose RPC credentials in service errors or logs", async () => {
    vi.mocked(publicClient.simulateContract).mockRejectedValue(new Error("https://rpc.example/private-key-token"));
    const response = await relay();
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ _tag: "SponsorUnavailable", reason: "service_unavailable" });
    expect(body).not.toContain("private-key-token");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private-key-token");
    expect(writeContract).not.toHaveBeenCalled();
  });
});

const space = address("7");
async function batchPayload() {
  await database.insert(spaceDrafts).values({ id: randomUUID(), owner: owner.toLowerCase(), name: "Funded", templateId: "recurring-support",
    spaceAddress: space, tokenAddress: token, activatedAt: new Date() });
  return { forwarder, from: owner, nonce: "0", deadline: String(Math.floor(Date.now() / 1000) + 300), signature: `0x${"0".repeat(130)}`,
    calls: [
      { to: token, gas: "150000", data: encodeFunctionData({ abi: accordTestUSDCAbi, functionName: "approve", args: [space, 100n] }) },
      { to: space, gas: "1500000", data: encodeFunctionData({ abi: spaceAccountAbi, functionName: "fundAllocation", args: [1n, 100n] }) },
    ] };
}

describe("atomic sponsorship", () => {
  it("allows only the owner's authorized namespace preparation, never direct registrar calls", async () => {
    const payload = await batchPayload(), namespace = address("8"), registry = address("9");
    vi.stubEnv("SPACE_NAMESPACE_ADDRESS", namespace);
    const draftId = randomUUID();
    await database.insert(spaceDrafts).values({ id: draftId, owner: owner.toLowerCase(), name: "Managed", templateId: "recurring-support", spaceAddress: address("a"), tokenAddress: token, activatedAt: new Date() });
    await database.insert(spaceNamespaces).values({ draftId, spaceAddress: address("a"), name: "managed.accord.eth", registry });
    const args = [registry, transactionHash, "agent", sponsor, 2_000_000_000n, Number(payload.deadline), payload.signature as Hex] as const;
    payload.calls = [{ to: namespace, gas: "1500000", data: encodeFunctionData({ abi: spaceNamespaceAbi, functionName: "provisionAgentAuthorized", args }) }];
    expect((await post("/v1/sponsor/batch", payload)).status).toBe(200);
    payload.calls[0]!.data = encodeFunctionData({ abi: spaceNamespaceAbi, functionName: "provisionAgentAuthorized", args: [space, ...args.slice(1)] as never });
    expect((await post("/v1/sponsor/batch", payload)).status).toBe(403);
    payload.calls[0]!.data = encodeFunctionData({ abi: spaceNamespaceAbi, functionName: "provisionAgent", args: [registry, transactionHash, "agent", sponsor, 2_000_000_000n] });
    expect((await post("/v1/sponsor/batch", payload)).status).toBe(403);
    expect(writeContract).toHaveBeenCalledTimes(1);
  });
  it("binds named deployment to a saved draft and rejects the old entrypoint on the new factory", async () => {
    const payload = await batchPayload();
    vi.stubEnv("SPACE_NAMESPACE_ADDRESS", address("8"));
    payload.calls = [{ to: factory, gas: "7500000", data: encodeFunctionData({ abi: namedSpaceFactoryAbi, functionName: "createNamedSpace", args: [authorizer, token, "Savings"] }) }];
    expect((await post("/v1/sponsor/batch", payload)).status).toBe(200);
    payload.calls[0]!.data = encodeFunctionData({ abi: namedSpaceFactoryAbi, functionName: "createNamedSpace", args: [authorizer, token, "Another owner's draft"] });
    expect((await post("/v1/sponsor/batch", payload)).status).toBe(403);
    expect((await relay()).status).toBe(403);
  });
  it("keeps setup-only agent credentials out of both batch endpoints", async () => {
    const payload = await batchPayload();
    await database.update(sessions).set({ kind: "agent_setup" });
    expect((await post("/v1/sponsor/batch", payload)).status).toBe(403);
    const requests = payload.calls.map((call, index) => ({ ...call, forwarder, from: owner, nonce: String(index), value: "0", deadline: payload.deadline, signature: payload.signature }));
    expect((await post("/v1/sponsor/relay-batch", { requests })).status).toBe(403);
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("simulates and submits one signed batch, preserving call order", async () => {
    const payload = await batchPayload();
    const response = await post("/v1/sponsor/batch", payload);
    expect(response.status).toBe(200);
    expect(writeContract).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ address: forwarder, functionName: "executeSignedBatch",
      args: [owner, payload.calls.map(call => ({ ...call, gas: BigInt(call.gas) })), Number(payload.deadline), payload.signature] }));
  });
  it.each(["wrong-sender", "untrusted-target", "untrusted-forwarder", "other-spender", "unsupported-call"])("rejects %s before broadcasting", async kind => {
    const payload = await batchPayload();
    if (kind === "wrong-sender") payload.from = sponsor;
    if (kind === "untrusted-forwarder") payload.forwarder = sponsor;
    if (kind === "untrusted-target") payload.calls[1]!.to = sponsor;
    if (kind === "other-spender") payload.calls[0]!.data = encodeFunctionData({ abi: accordTestUSDCAbi, functionName: "approve", args: [sponsor, 100n] });
    if (kind === "unsupported-call") payload.calls[0]!.data = encodeFunctionData({ abi: accordTestUSDCAbi, functionName: "transfer", args: [sponsor, 100n] });
    expect((await post("/v1/sponsor/batch", payload)).status).toBe(403);
    expect(writeContract).not.toHaveBeenCalled();
  });
  it.each(["stale-nonce", "expired", "excessive-gas", "empty"])("rejects %s", async kind => {
    const payload = await batchPayload();
    if (kind === "stale-nonce") payload.nonce = "1";
    if (kind === "expired") payload.deadline = "1";
    if (kind === "excessive-gas") payload.calls[1]!.gas = "9000000";
    if (kind === "empty") payload.calls = [];
    expect((await post("/v1/sponsor/batch", payload)).status).toBe(400);
    expect(writeContract).not.toHaveBeenCalled();
  });
  it("does not broadcast any call when complete simulation fails", async () => {
    const payload = await batchPayload();
    vi.mocked(publicClient.simulateContract).mockRejectedValueOnce(new Error("Funding reverted"));
    expect((await post("/v1/sponsor/batch", payload)).status).toBe(503);
    expect(writeContract).not.toHaveBeenCalled();
  });
  it("wraps legacy execute calls with allowFailure=false, with consecutive nonces", async () => {
    const payload = await batchPayload();
    const requests = payload.calls.map((call, index) => ({ ...call, forwarder, from: owner, nonce: String(index), value: "0", deadline: payload.deadline, signature: payload.signature }));
    expect((await post("/v1/sponsor/relay-batch", { requests })).status).toBe(200);
    const call = writeContract.mock.calls[0]![0];
    expect(call.functionName).toBe("aggregate3");
    for (const entry of call.args[0]) {
      expect(entry).toMatchObject({ target: forwarder, allowFailure: false });
      expect(decodeFunctionData({ abi: accordForwarderAbi, data: entry.callData }).functionName).toBe("execute");
    }
    requests[1]!.nonce = "0";
    expect((await post("/v1/sponsor/relay-batch", { requests })).status).toBe(400);
    expect(writeContract).toHaveBeenCalledTimes(1);
  });
  it("continues to sponsor explicitly allowlisted legacy Spaces", async () => {
    const payload = await batchPayload();
    vi.stubEnv("LEGACY_DEMO_TOKEN_ADDRESS", token);
    vi.stubEnv("LEGACY_FORWARDER_ADDRESS", forwarder);
    vi.stubEnv("DEMO_TOKEN_ADDRESS", address("8"));
    vi.stubEnv("FORWARDER_ADDRESS", address("9"));
    expect((await post("/v1/sponsor/batch", payload)).status).toBe(200);
  });
});
