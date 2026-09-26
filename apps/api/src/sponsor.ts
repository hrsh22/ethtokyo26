import { AccordApi } from "@accord/api-contract";
import { accordForwarderAbi, accordTestUSDCAbi, spaceAccountAbi, spaceFactoryAbi } from "@accord/chain";
import { HttpApiBuilder, HttpApiError } from "@effect/platform";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { decodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
import { assertAgentScope, currentSession, requireBrowserOrigin } from "./auth";
import { connectionIdentity } from "./agent-connection";
import { adapterAddress, factoryAddress, permitSigner, publicClient } from "./chain";
import { Database } from "./db";
import { databaseOperation } from "./db/run";
import { agentSubmissions, permitIntents, researchQuotes, spaceDrafts } from "./db/schema";
import { serial } from "./serial";
import { fundedFees, sponsor, sponsorFailure } from "./sponsor-wallet";

const allowedSpaceCalls = new Set([
  "createAllocation", "createTimedAllocation", "fundAllocation", "fundAgentAllocation", "claim", "setMandate", "pay",
  "revokeMandate", "recoverAllocation",
]);
const lastFaucet = new Map<string, number>();
const faucetCooldownMs = 10_000;

function configuredAddress(name: string): Address {
  const value = process.env[name];
  if (!value || !isAddress(value)) throw new Error(`${name} is not configured`);
  return getAddress(value);
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
        const fees = await fundedFees(wallet.account.address, 180_000n);
        const call = { address: token, abi: accordTestUSDCAbi,
          functionName: "faucetTo", args: [account], account: wallet.account } as const;
        await publicClient.simulateContract(call);
        const transactionHash = await wallet.writeContract({ ...call, ...fees });
        return { transactionHash };
      },
      catch: (error) => sponsorFailure(error, "faucet"),
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
    let scopedRequestId: string | undefined;
    if (session.connection) {
      yield* assertAgentScope(session, { spaceAddress: to });
      const requestId = yield* Effect.tryPromise({ try: async () => {
        const call = decodeFunctionData({ abi: spaceAccountAbi, data: payload.data as Hex });
        if (call.functionName !== "pay") throw new Error("Agent connections can only relay payments");
        const [allocationId, recipient, amount, permit] = call.args;
        if (allocationId.toString() !== session.connection!.allocationId) throw new Error("Wrong allocation");
        const [intent] = await db.client.select().from(permitIntents).where(eq(permitIntents.requestId, permit.requestId));
        const [quote] = intent ? await db.client.select().from(researchQuotes).where(and(eq(researchQuotes.id, intent.requestKey),
          eq(researchQuotes.connectionId, session.connection!.id))) : [];
        if (!quote || quote.actor !== session.address || quote.spaceAddress.toLowerCase() !== to.toLowerCase() || quote.allocationId !== allocationId.toString() ||
          quote.amount !== amount.toString() || quote.recipient.toLowerCase() !== recipient.toLowerCase()) throw new Error("Wrong purchase");
        return permit.requestId;
      }, catch: () => new HttpApiError.Forbidden() });
      scopedRequestId = requestId;
      const [saved] = yield* databaseOperation(() => db.client.select().from(agentSubmissions).where(and(
        eq(agentSubmissions.requestId, requestId), eq(agentSubmissions.connectionId, session.connection!.id))));
      if (saved) return { transactionHash: saved.transactionHash };
      yield* Effect.tryPromise({ try: () => connectionIdentity(db.client, session.connection!), catch: () => new HttpApiError.Forbidden() });
    }
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
      try: () => serial(`agent-relay:${from}`, async () => {
        if (scopedRequestId) {
          const [saved] = await db.client.select().from(agentSubmissions).where(eq(agentSubmissions.requestId, scopedRequestId));
          if (saved) return { transactionHash: saved.transactionHash };
        }
        const wallet = sponsor();
        const call = { address: forwarder, abi: accordForwarderAbi,
          functionName: "execute", args: [request], account: wallet.account } as const;
        await publicClient.simulateContract(call);
        const estimate = await publicClient.estimateContractGas(call);
        const gasLimit=estimate*125n/100n;
        const fees = await fundedFees(wallet.account.address,gasLimit);
        const transactionHash = await wallet.writeContract({...call,gas:gasLimit,...fees});
        if (scopedRequestId && session.connection) await db.client.insert(agentSubmissions).values({
          requestId: scopedRequestId, connectionId: session.connection.id, transactionHash,
        }).onConflictDoNothing();
        return { transactionHash };
      }),
      catch: (error) => sponsorFailure(error, "relay"),
    });
  })),
);
