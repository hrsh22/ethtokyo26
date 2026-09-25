import { AccordApi } from "@accord/api-contract";
import { accordForwarderAbi, accordTestUSDCAbi, spaceAccountAbi, spaceFactoryAbi } from "@accord/chain";
import { HttpApiBuilder, HttpApiError } from "@effect/platform";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { createWalletClient, decodeFunctionData, getAddress, http, isAddress, type Address, type Hex } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { currentSession, requireBrowserOrigin } from "./auth";
import { adapterAddress, factoryAddress, permitSigner, publicClient } from "./chain";
import { Database } from "./db";
import { databaseOperation } from "./db/run";
import { spaceDrafts } from "./db/schema";

const allowedSpaceCalls = new Set([
  "createAllocation", "createTimedAllocation", "fundAllocation", "claim", "setMandate", "pay",
  "revokeMandate", "recoverAllocation",
]);
const lastFaucet = new Map<string, number>();
const faucetCooldownMs = 10_000;

function sponsor() {
  const key = process.env.SPONSOR_PRIVATE_KEY;
  if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("Sponsor wallet is not configured");
  const account = privateKeyToAccount(key as Hex, { nonceManager });
  return createWalletClient({ account, chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com") });
}

function configuredAddress(name: string): Address {
  const value = process.env[name];
  if (!value || !isAddress(value)) throw new Error(`${name} is not configured`);
  return getAddress(value);
}

async function enoughGas(address: Address, gas: bigint) {
  const [balance, fees] = await Promise.all([
    publicClient.getBalance({ address }), publicClient.estimateFeesPerGas(),
  ]);
  const reserve = BigInt(process.env.SPONSOR_MIN_BALANCE_WEI ?? "1000000000000000");
  if (balance < reserve + gas * fees.maxFeePerGas) throw new Error("Sponsor wallet needs Sepolia ETH");
}

export const SponsorLive = HttpApiBuilder.group(AccordApi, "sponsor", (handlers) => handlers
  .handle("faucet", () => Effect.gen(function* () {
    yield* requireBrowserOrigin();
    const session = yield* currentSession();
    const account = getAddress(session.address);
    const last = lastFaucet.get(account.toLowerCase()) ?? 0;
    if (Date.now() - last < faucetCooldownMs) return yield* Effect.fail(new HttpApiError.BadRequest());
    lastFaucet.set(account.toLowerCase(), Date.now());
    return yield* Effect.tryPromise({
      try: async () => {
        const wallet = sponsor();
        const token = configuredAddress("DEMO_TOKEN_ADDRESS");
        await enoughGas(wallet.account.address, 180_000n);
        const simulation = await publicClient.simulateContract({ address: token, abi: accordTestUSDCAbi,
          functionName: "faucetTo", args: [account], account: wallet.account });
        const transactionHash = await wallet.writeContract(simulation.request);
        return { transactionHash };
      },
      catch: () => new HttpApiError.ServiceUnavailable(),
    });
  }))
  .handle("relay", ({ payload }) => Effect.gen(function* () {
    yield* requireBrowserOrigin();
    const session = yield* currentSession();
    const from = getAddress(payload.from);
    const to = getAddress(payload.to);
    if (from.toLowerCase() !== session.address.toLowerCase() || payload.value !== "0") {
      return yield* Effect.fail(new HttpApiError.Forbidden());
    }
    const gas = BigInt(payload.gas);
    const nonce = BigInt(payload.nonce);
    const deadline = BigInt(payload.deadline);
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (gas < 30_000n || gas > 8_000_000n || deadline < now || deadline > now + 600n || deadline >= 1n << 48n) {
      return yield* Effect.fail(new HttpApiError.BadRequest());
    }
    const db = yield* Database;
    const factory = yield* Effect.try({ try: factoryAddress, catch: () => new HttpApiError.ServiceUnavailable() });
    const token = yield* Effect.try({ try: () => configuredAddress("DEMO_TOKEN_ADDRESS"),
      catch: () => new HttpApiError.ServiceUnavailable() });
    let allowed = false;
    if (to.toLowerCase() === factory.toLowerCase()) {
      try {
        const call = decodeFunctionData({ abi: spaceFactoryAbi, data: payload.data as Hex });
        const args = call.args as readonly Address[];
        allowed = call.functionName === "createSpace" && args[0]?.toLowerCase() === permitSigner().address.toLowerCase()
          && args[1]?.toLowerCase() === token.toLowerCase() && args[2]?.toLowerCase() === adapterAddress().toLowerCase();
      } catch { /* Invalid calldata is rejected below. */ }
      if (allowed) {
        const drafts = yield* databaseOperation(() => db.client.select({ id: spaceDrafts.id }).from(spaceDrafts)
          .where(and(eq(spaceDrafts.owner, session.address), isNull(spaceDrafts.spaceAddress))).limit(1));
        allowed = drafts.length > 0;
      }
    } else if (to.toLowerCase() === token.toLowerCase()) {
      try {
        const call = decodeFunctionData({ abi: accordTestUSDCAbi, data: payload.data as Hex });
        if (call.functionName === "approve") {
          const args = call.args as readonly unknown[];
          const rows = yield* databaseOperation(() => db.client.select({ id: spaceDrafts.id }).from(spaceDrafts)
            .where(and(eq(spaceDrafts.owner, session.address), eq(spaceDrafts.spaceAddress, getAddress(String(args[0]))),
              eq(spaceDrafts.tokenAddress, token), isNotNull(spaceDrafts.activatedAt))).limit(1));
          allowed = rows.length > 0;
        }
      } catch { /* Invalid calldata is rejected below. */ }
    } else {
      const rows = yield* databaseOperation(() => db.client.select({ id: spaceDrafts.id }).from(spaceDrafts)
        .where(and(eq(spaceDrafts.spaceAddress, to), eq(spaceDrafts.tokenAddress, token),
          isNotNull(spaceDrafts.activatedAt))).limit(1));
      if (rows.length) {
        try {
          const call = decodeFunctionData({ abi: spaceAccountAbi, data: payload.data as Hex });
          allowed = allowedSpaceCalls.has(call.functionName);
        } catch { /* Invalid calldata is rejected below. */ }
      }
    }
    if (!allowed) return yield* Effect.fail(new HttpApiError.Forbidden());
    const forwarder = yield* Effect.try({ try: () => configuredAddress("FORWARDER_ADDRESS"),
      catch: () => new HttpApiError.ServiceUnavailable() });
    const request = { from, to, value: 0n, gas, deadline: Number(deadline),
      data: payload.data as Hex, signature: payload.signature as Hex };
    const valid = yield* Effect.tryPromise({ try: async () => {
      const [currentNonce, verified] = await Promise.all([
        publicClient.readContract({ address: forwarder, abi: accordForwarderAbi, functionName: "nonces", args: [from] }),
        publicClient.readContract({ address: forwarder, abi: accordForwarderAbi, functionName: "verify", args: [request] }),
      ]);
      return currentNonce === nonce && verified;
    }, catch: () => new HttpApiError.BadRequest() });
    if (!valid) return yield* Effect.fail(new HttpApiError.BadRequest());
    return yield* Effect.tryPromise({
      try: async () => {
        const wallet = sponsor();
        await enoughGas(wallet.account.address, gas + 120_000n);
        const simulation = await publicClient.simulateContract({ address: forwarder, abi: accordForwarderAbi,
          functionName: "execute", args: [request], account: wallet.account });
        const transactionHash = await wallet.writeContract(simulation.request);
        return { transactionHash };
      },
      catch: () => new HttpApiError.ServiceUnavailable(),
    });
  })),
);
