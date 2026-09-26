import { AccordApi, type SponsoredRequest } from "@accord/api-contract";
import { accordForwarderAbi, accordTestUSDCAbi, spaceAccountAbi, namedSpaceFactoryAbi, spaceNamespaceAbi } from "@accord/chain";
import { HttpApiBuilder, HttpApiError } from "@effect/platform";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { decodeFunctionData, encodeFunctionData, getAddress, isAddress, multicall3Abi, type Address, type Hex } from "viem";
import { assertAgentScope, currentSession, requireBrowserOrigin } from "./auth";
import { connectionIdentity } from "./agent-connection";
import { configuredAddresses, isConfiguredAddress, permitSigner, publicClient } from "./chain";
import { Database, type DatabaseClient } from "./db";
import { sepolia } from "viem/chains";
import { databaseOperation } from "./db/run";
import { agentSubmissions, permitIntents, researchQuotes, spaceDrafts, spaceNamespaces } from "./db/schema";
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

function authorizeTarget(payload: Pick<typeof SponsoredRequest.Type, "to" | "data">, owner: string, database: DatabaseClient) {
  return Effect.gen(function* () {
    const to = getAddress(payload.to);
    const token = yield* Effect.try({ try: () => configuredAddress("DEMO_TOKEN_ADDRESS"),
      catch: () => new HttpApiError.ServiceUnavailable() });
    let allowed = false;
    if (isConfiguredAddress("SPACE_FACTORY_ADDRESS", to)) {
      let name: string | undefined;
      try {
        const call = decodeFunctionData({ abi: namedSpaceFactoryAbi, data: payload.data as Hex });
        const args = call.args as readonly Address[];
        allowed = call.functionName === "createSpace" && !(process.env.SPACE_NAMESPACE_ADDRESS && to.toLowerCase() === process.env.SPACE_FACTORY_ADDRESS?.toLowerCase()) && args[0]?.toLowerCase() === permitSigner().address.toLowerCase()
          && isConfiguredAddress("DEMO_TOKEN_ADDRESS", args[1]!) && isConfiguredAddress("ENS_ADAPTER_ADDRESS", args[2]!);
        if (call.functionName === "createNamedSpace") {
          name = call.args[2];
          allowed = call.args[0].toLowerCase() === permitSigner().address.toLowerCase() && call.args[1].toLowerCase() === token.toLowerCase();
        }
      } catch { /* Invalid calldata is rejected below. */ }
      if (allowed) {
        const drafts = yield* databaseOperation(() => database.select({ id: spaceDrafts.id }).from(spaceDrafts)
          .where(and(eq(spaceDrafts.owner, owner), isNull(spaceDrafts.spaceAddress), ...(name ? [eq(spaceDrafts.name, name)] : []))).limit(1));
        allowed = drafts.length > 0;
      }
    } else if (process.env.SPACE_NAMESPACE_ADDRESS?.toLowerCase() === to.toLowerCase()) {
      try {
        const call = decodeFunctionData({ abi: spaceNamespaceAbi, data: payload.data as Hex });
        if (call.functionName === "provisionAgentAuthorized") {
          const rows = yield* databaseOperation(() => database.select({ id: spaceDrafts.id }).from(spaceNamespaces)
            .innerJoin(spaceDrafts, eq(spaceNamespaces.draftId, spaceDrafts.id))
            .where(and(eq(spaceNamespaces.registry, getAddress(call.args[0])), eq(spaceDrafts.owner, owner), isNotNull(spaceDrafts.activatedAt))).limit(1));
          allowed = rows.length > 0;
        }
      } catch { /* Invalid calldata is rejected below. */ }
    } else if (isConfiguredAddress("DEMO_TOKEN_ADDRESS", to)) {
      try {
        const call = decodeFunctionData({ abi: accordTestUSDCAbi, data: payload.data as Hex });
        if (call.functionName === "approve") {
          const args = call.args as readonly unknown[];
          const rows = yield* databaseOperation(() => database.select({ id: spaceDrafts.id }).from(spaceDrafts)
            .where(and(eq(spaceDrafts.owner, owner), eq(spaceDrafts.spaceAddress, getAddress(String(args[0]))),
              eq(spaceDrafts.tokenAddress, to), isNotNull(spaceDrafts.activatedAt))).limit(1));
          allowed = rows.length > 0;
        }
      } catch { /* Invalid calldata is rejected below. */ }
    } else {
      const rows = yield* databaseOperation(() => database.select({ id: spaceDrafts.id }).from(spaceDrafts)
        .where(and(eq(spaceDrafts.spaceAddress, to), inArray(spaceDrafts.tokenAddress, configuredAddresses("DEMO_TOKEN_ADDRESS")),
          isNotNull(spaceDrafts.activatedAt))).limit(1));
      if (rows.length) {
        try {
          const call = decodeFunctionData({ abi: spaceAccountAbi, data: payload.data as Hex });
          allowed = allowedSpaceCalls.has(call.functionName);
        } catch { /* Invalid calldata is rejected below. */ }
      }
    }
    if (!allowed) return yield* Effect.fail(new HttpApiError.Forbidden());
  });
}

function requestForwarder(value?: string) {
  const forwarder = value ? getAddress(value) : configuredAddress("FORWARDER_ADDRESS");
  if (!isConfiguredAddress("FORWARDER_ADDRESS", forwarder)) throw new Error("Untrusted forwarder");
  return forwarder;
}

function faucet(tokenAddress?: string) {
  return Effect.gen(function* () {
    yield* requireBrowserOrigin();
    const session = yield* currentSession();
    if (tokenAddress && !isConfiguredAddress("DEMO_TOKEN_ADDRESS", tokenAddress)) return yield* Effect.fail(new HttpApiError.Forbidden());
    const account = getAddress(session.address);
    const last = lastFaucet.get(account.toLowerCase()) ?? 0;
    if (Date.now() - last < faucetCooldownMs) return yield* Effect.fail(new HttpApiError.BadRequest());
    lastFaucet.set(account.toLowerCase(), Date.now());
    return yield* Effect.tryPromise({
      try: async () => {
        const wallet = sponsor();
        const token = tokenAddress ? getAddress(tokenAddress) : configuredAddress("DEMO_TOKEN_ADDRESS");
        const fees = await fundedFees(wallet.account.address, 180_000n);
        const call = { address: token, abi: accordTestUSDCAbi,
          functionName: "faucetTo", args: [account], account: wallet.account } as const;
        await publicClient.simulateContract(call);
        const transactionHash = await wallet.writeContract({ ...call, ...fees });
        return { transactionHash };
      },
      catch: (error) => sponsorFailure(error, "faucet"),
    });
  });
}

export const SponsorLive = HttpApiBuilder.group(AccordApi, "sponsor", (handlers) => handlers
  .handle("faucet", () => faucet())
  .handle("faucetFor", ({ payload }) => faucet(payload.tokenAddress))
  .handle("executeBatch", ({ payload }) => Effect.gen(function* () {
    yield* requireBrowserOrigin();
    const session = yield* currentSession();
    if (session.connection || payload.from.toLowerCase() !== session.address.toLowerCase()) {
      return yield* Effect.fail(new HttpApiError.Forbidden());
    }
    const forwarder = yield* Effect.try({ try: () => requestForwarder(payload.forwarder), catch: () => new HttpApiError.Forbidden() });
    const now = BigInt(Math.floor(Date.now() / 1000)), deadline = BigInt(payload.deadline);
    if (deadline < now || deadline > now + 600n || deadline >= 1n << 48n) return yield* Effect.fail(new HttpApiError.BadRequest());
    const db = yield* Database;
    let totalGas = 0n;
    for (const call of payload.calls) {
      const gas = BigInt(call.gas);
      totalGas += gas;
      if (gas < 30_000n || gas > 8_000_000n || totalGas > 10_000_000n) return yield* Effect.fail(new HttpApiError.BadRequest());
      yield* authorizeTarget(call, session.address, db.client);
    }
    return yield* Effect.tryPromise({
      try: () => serial(`agent-relay:${session.address}`, async () => {
        const from = getAddress(payload.from);
        if (await publicClient.readContract({ address: forwarder, abi: accordForwarderAbi, functionName: "nonces", args: [from] }) !== BigInt(payload.nonce)) {
          throw new HttpApiError.BadRequest();
        }
        const wallet = sponsor();
        const calls = payload.calls.map(call => ({ to: getAddress(call.to), gas: BigInt(call.gas), data: call.data as Hex }));
        const call = { address: forwarder, abi: accordForwarderAbi, functionName: "executeSignedBatch",
          args: [from, calls, Number(deadline), payload.signature as Hex], account: wallet.account } as const;
        await publicClient.simulateContract(call);
        const gas = (await publicClient.estimateContractGas(call)) * 125n / 100n;
        const fees = await fundedFees(wallet.account.address, gas);
        return { transactionHash: await wallet.writeContract({ ...call, gas, ...fees }) };
      }),
      catch: error => error instanceof HttpApiError.BadRequest ? error : sponsorFailure(error, "relay"),
    });
  }))
  .handle("relayBatch", ({ payload }) => Effect.gen(function* () {
    yield* requireBrowserOrigin();
    const session = yield* currentSession();
    // Scoped agent credentials keep their existing single-purchase relay and recovery rules.
    if (session.connection) return yield* Effect.fail(new HttpApiError.Forbidden());
    const db = yield* Database;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const firstNonce = BigInt(payload.requests[0]!.nonce);
    let totalGas = 0n;
    for (const [index, request] of payload.requests.entries()) {
      if (request.from.toLowerCase() !== session.address.toLowerCase() || request.value !== "0" ||
        request.forwarder?.toLowerCase() !== payload.requests[0]!.forwarder?.toLowerCase()) {
        return yield* Effect.fail(new HttpApiError.Forbidden());
      }
      const gas = BigInt(request.gas), deadline = BigInt(request.deadline);
      totalGas += gas;
      if (gas < 30_000n || gas > 8_000_000n || totalGas > 10_000_000n ||
        BigInt(request.nonce) !== firstNonce + BigInt(index) ||
        deadline < now || deadline > now + 600n || deadline >= 1n << 48n) {
        return yield* Effect.fail(new HttpApiError.BadRequest());
      }
      yield* authorizeTarget(request, session.address, db.client);
    }
    const forwarder = yield* Effect.try({ try: () => requestForwarder(payload.requests[0]!.forwarder),
      catch: () => new HttpApiError.ServiceUnavailable() });
    return yield* Effect.tryPromise({
      try: () => serial(`agent-relay:${session.address}`, async () => {
        const from = getAddress(session.address);
        const nonce = await publicClient.readContract({ address: forwarder, abi: accordForwarderAbi,
          functionName: "nonces", args: [from] });
        if (nonce !== firstNonce) throw new HttpApiError.BadRequest();
        const wallet = sponsor();
        // executeBatch can swallow a zero-value target revert in the deployed OZ forwarder.
        // aggregate3 instead wraps individual execute calls, each of which MUST succeed.
        // Every target still sees the signed ERC-2771 sender, never the multicall address.
        const calls = payload.requests.map((request) => ({ target: forwarder, allowFailure: false,
          callData: encodeFunctionData({ abi: accordForwarderAbi, functionName: "execute", args: [{
            from, to: getAddress(request.to), value: 0n, gas: BigInt(request.gas),
            deadline: Number(request.deadline), data: request.data as Hex, signature: request.signature as Hex,
          }] }),
        }));
        const call = { address: sepolia.contracts.multicall3.address, abi: multicall3Abi,
          functionName: "aggregate3", args: [calls], account: wallet.account } as const;
        // Simulate the complete sequence: later signatures depend on earlier nonces,
        // and funding depends on the approval made earlier in the same transaction.
        await publicClient.simulateContract(call);
        const gas = (await publicClient.estimateContractGas(call)) * 125n / 100n;
        const fees = await fundedFees(wallet.account.address, gas);
        const transactionHash = await wallet.writeContract({ ...call, gas, ...fees });
        return { transactionHash };
      }),
      catch: (error) => error instanceof HttpApiError.BadRequest ? error : sponsorFailure(error, "relay"),
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
    yield* authorizeTarget(payload, session.address, db.client);
    const forwarder = yield* Effect.tryPromise({ try: async () => requestForwarder(payload.forwarder ??
      (process.env.LEGACY_FORWARDER_ADDRESS ? await publicClient.readContract({ address: to, abi: spaceAccountAbi, functionName: "trustedForwarder" }) : undefined)),
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
      try: () => serial(`agent-relay:${from.toLowerCase()}`, async () => {
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
