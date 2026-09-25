import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { HttpApiBuilder, HttpServer } from "@effect/platform";
import { Layer } from "effect";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { spaceFactoryAbi } from "@accord/chain";
import { ApiLive } from "./app";
import { publicClient } from "./chain";
import { Database } from "./db";
import { sessions, spaceDrafts } from "./db/schema";
import * as sponsorWallet from "./sponsor-wallet";

const address = (n: string) => getAddress(`0x${n.repeat(40)}`);
const owner = address("1"), factory = address("2"), token = address("3"), adapter = address("4");
const forwarder = address("5"), sponsor = address("6");
const key = `0x${"0".repeat(63)}1` as Hex, authorizer = privateKeyToAccount(key).address;
const bearer = "a".repeat(64), transactionHash = `0x${"b".repeat(64)}` as Hex;
const fees = { maxFeePerGas: 1_200_000_000n, maxPriorityFeePerGas: 1_000_000n };
let connection: ReturnType<typeof createClient>, api: ReturnType<typeof HttpApiBuilder.toWebHandler>;
const writeContract = vi.fn();

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
