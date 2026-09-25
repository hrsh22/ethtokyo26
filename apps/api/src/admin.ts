import { AccordApi } from "@accord/api-contract";
import { ensPermissionAdapterAbi, hashAllocationTerms, hashTimedAllocationTerms, hashMandateTerms, hashSpacePermit, PermitAction, signSpacePermit, spaceAccountAbi, type SpacePermit } from "@accord/chain";
import { HttpApiBuilder, HttpApiError } from "@effect/platform";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { randomBytes } from "node:crypto";
import { encodeAbiParameters, encodeFunctionData, getAddress, isAddress, keccak256, stringToHex, zeroAddress, zeroHash, type Address } from "viem";
import { currentSession, requireBrowserOrigin } from "./auth";
import { adapterAddress, permitSigner, publicClient } from "./chain";
import { Database } from "./db";
import { databaseOperation } from "./db/run";
import { allocationNames, spaceDrafts } from "./db/schema";
import { normalizeRecipientName, resolveRecipientName } from "./ens-recipient";

function uint(value: string, bits = 256n) {
  const result = BigInt(value);
  if (result < 0n || result >= (1n << bits)) throw new Error("Integer out of range");
  return result;
}

// Owner setup uses wallet authentication plus onchain ownership. World is a claim gate.
function ownerSpace(draftId: string) {
  return Effect.gen(function* () {
    yield* requireBrowserOrigin();
    const session = yield* currentSession();
    const db = yield* Database;
    const rows = yield* databaseOperation(() => db.client.select().from(spaceDrafts)
      .where(and(eq(spaceDrafts.id, draftId), eq(spaceDrafts.owner, session.address))).limit(1));
    const draft = rows[0];
    if (!draft?.activatedAt || !draft.spaceAddress || !draft.tokenAddress || !draft.deploymentTx) {
      return yield* Effect.fail(new HttpApiError.Forbidden());
    }
    return yield* Effect.tryPromise({
      try: async () => {
        const space = getAddress(draft.spaceAddress!);
        const token = getAddress(draft.tokenAddress!);
        const actor = getAddress(session.address);
        const signer = permitSigner();
        const adapter = adapterAddress();
        const block = await publicClient.getBlock();
        const read = { address: space, abi: spaceAccountAbi, blockNumber: block.number } as const;
        const [owner, authorizer, actualToken, actualAdapter, policyVersion, chainId] = await Promise.all([
          publicClient.readContract({ ...read, functionName: "owner" }),
          publicClient.readContract({ ...read, functionName: "authorizer" }),
          publicClient.readContract({ ...read, functionName: "token" }),
          publicClient.readContract({ ...read, functionName: "ensAdapter" }),
          publicClient.readContract({ ...read, functionName: "policyVersion" }),
          publicClient.getChainId(),
        ]);
        if (chainId !== 11155111 || owner.toLowerCase() !== actor.toLowerCase() ||
          authorizer.toLowerCase() !== signer.address.toLowerCase() ||
          actualToken.toLowerCase() !== token.toLowerCase() || actualAdapter.toLowerCase() !== adapter.toLowerCase()) {
          throw new Error("Untrusted Space");
        }
        return { space, token, actor, signer, adapter, policyVersion, block };
      },
      catch: () => new HttpApiError.Forbidden(),
    });
  });
}

type Context = Effect.Effect.Success<ReturnType<typeof ownerSpace>>;

async function makePermit(context: Context, requestKey: string, action: 0 | 1 | 4 | 5, allocationId: bigint,
  recipient: Address, amount: bigint, detailsHash: `0x${string}`): Promise<SpacePermit> {
  const requestId = keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "bytes32" }],
    [context.space, context.actor, keccak256(stringToHex(requestKey))],
  ));
  const consumed = await publicClient.readContract({ address: context.space, abi: spaceAccountAbi,
    functionName: "consumedRequests", args: [requestId] });
  if (consumed) throw new Error("Request already executed");
  return { actor: context.actor, action, allocationId, recipient, amount, requestId,
    nonce: BigInt(`0x${randomBytes(32).toString("hex")}`),
    expiry: context.block.timestamp + 300n, policyVersion: context.policyVersion, detailsHash };
}

function envelope(context: Context, permit: SpacePermit, signature: `0x${string}`,
  functionName: "createAllocation" | "createTimedAllocation" | "setMandate" | "revokeMandate" | "recoverAllocation", calldata: `0x${string}`, approvalAmount: bigint) {
  return {
    spaceAddress: context.space, tokenAddress: context.token, functionName, calldata, signature,
    digest: hashSpacePermit(context.space, permit), approvalAmount: approvalAmount.toString(),
    permit: { ...permit, action: permit.action as 0 | 1 | 4 | 5,
      allocationId: permit.allocationId.toString(), amount: permit.amount.toString(),
      nonce: permit.nonce.toString(), expiry: permit.expiry.toString(), policyVersion: permit.policyVersion.toString() },
  };
}

export const AdminLive = HttpApiBuilder.group(AccordApi, "admin", (handlers) => handlers
  .handle("recoverAllocation", ({ payload }) => Effect.gen(function* () {
    const context = yield* ownerSpace(payload.draftId);
    return yield* Effect.tryPromise({
      try: async () => {
        const allocationId = uint(payload.allocationId);
        const [allocation, nextId] = await Promise.all([
          publicClient.readContract({ address: context.space, abi: spaceAccountAbi,
            functionName: "allocations", args: [allocationId], blockNumber: context.block.number }),
          publicClient.readContract({ address: context.space, abi: spaceAccountAbi,
            functionName: "nextAllocationId", blockNumber: context.block.number }),
        ]);
        if (allocationId === 0n || allocationId >= nextId || allocation[6]) {
          throw new Error("Allocation is unavailable");
        }
        const permit = await makePermit(context, payload.requestKey, PermitAction.RecoverAllocation,
          allocationId, context.actor, allocation[1], zeroHash);
        const signature = await signSpacePermit(context.signer, context.space, permit);
        const args = [allocationId, permit, signature] as const;
        await publicClient.simulateContract({ address: context.space, abi: spaceAccountAbi,
          functionName: "recoverAllocation", args, account: context.actor });
        return envelope(context, permit, signature, "recoverAllocation",
          encodeFunctionData({ abi: spaceAccountAbi, functionName: "recoverAllocation", args }), 0n);
      },
      catch: () => new HttpApiError.BadRequest(),
    });
  }))
  .handle("revokeMandate", ({ payload }) => Effect.gen(function* () {
    const context = yield* ownerSpace(payload.draftId);
    return yield* Effect.tryPromise({
      try: async () => {
        const allocationId = uint(payload.allocationId);
        const mandate = await publicClient.readContract({ address: context.space, abi: spaceAccountAbi,
          functionName: "mandates", args: [allocationId], blockNumber: context.block.number });
        if (allocationId === 0n || !mandate[9]) throw new Error("Mandate is not active");
        const permit = await makePermit(context, payload.requestKey, PermitAction.RevokeMandate,
          allocationId, zeroAddress, 0n, zeroHash);
        const signature = await signSpacePermit(context.signer, context.space, permit);
        const args = [allocationId, permit, signature] as const;
        await publicClient.simulateContract({ address: context.space, abi: spaceAccountAbi,
          functionName: "revokeMandate", args, account: context.actor });
        return envelope(context, permit, signature, "revokeMandate",
          encodeFunctionData({ abi: spaceAccountAbi, functionName: "revokeMandate", args }), 0n);
      },
      catch: () => new HttpApiError.BadRequest(),
    });
  }))
  .handle("createAllocation", ({ payload }) => Effect.gen(function* () {
    const context = yield* ownerSpace(payload.draftId);
    const db = yield* Database;
    let beneficiaryName: string | undefined;
    try { beneficiaryName = payload.beneficiaryEnsName ? normalizeRecipientName(payload.beneficiaryEnsName) : undefined; }
    catch { return yield* Effect.fail(new HttpApiError.BadRequest()); }
    const ensRecipient = beneficiaryName ? yield* Effect.tryPromise({
      try: () => resolveRecipientName(beneficiaryName!, context.block.number),
      catch: () => new HttpApiError.ServiceUnavailable(),
    }) : undefined;
    if (payload.beneficiaryEnsName && (!ensRecipient || ensRecipient.address.toLowerCase() !== payload.beneficiary.toLowerCase())) {
      return yield* Effect.fail(new HttpApiError.Conflict());
    }
    return yield* Effect.tryPromise({
      try: async () => {
        const beneficiary = getAddress(payload.beneficiary);
        const amount = uint(payload.amount);
        const periodCap = uint(payload.periodCap);
        if (amount === 0n || periodCap === 0n || periodCap > amount ||
          (payload.period === 0 && periodCap !== amount)) throw new Error("Invalid allocation terms");
        const schedule = payload.schedule;
        if ((payload.period === 3) !== !!schedule) throw new Error("Interval allocations require a schedule");
        if (schedule) {
          if (schedule.durationSeconds < schedule.intervalSeconds || schedule.durationSeconds % schedule.intervalSeconds !== 0) throw new Error("Invalid allocation duration");
          const version = await publicClient.readContract({ address: context.space, abi: spaceAccountAbi,
            functionName: "allocationScheduleVersion", blockNumber: context.block.number });
          if (version !== 1n) throw new Error("Create a new Space to use timed allocations");
        }
        const allocationId = await publicClient.readContract({ address: context.space, abi: spaceAccountAbi,
          functionName: "nextAllocationId", blockNumber: context.block.number });
        const permit = await makePermit(context, payload.requestKey, PermitAction.CreateAllocation,
          allocationId, beneficiary, amount, schedule
            ? hashTimedAllocationTerms(periodCap, schedule.intervalSeconds, schedule.durationSeconds)
            : hashAllocationTerms(periodCap, payload.period as 0 | 1 | 2));
        const signature = await signSpacePermit(context.signer, context.space, permit);
        const calldata = schedule
          ? encodeFunctionData({ abi: spaceAccountAbi, functionName: "createTimedAllocation",
            args: [beneficiary, amount, periodCap, schedule.intervalSeconds, schedule.durationSeconds, permit, signature] })
          : encodeFunctionData({ abi: spaceAccountAbi, functionName: "createAllocation",
            args: [beneficiary, amount, periodCap, payload.period, permit, signature] });
        if (ensRecipient) await db.client.insert(allocationNames).values({
          requestId: permit.requestId, spaceAddress: context.space,
          allocationId: allocationId.toString(), beneficiary, name: ensRecipient.name,
          resolvedBlock: ensRecipient.blockNumber,
        }).onConflictDoNothing();
        // Funding may not yet be approved. The client approves approvalAmount, then simulates this call.
        return envelope(context, permit, signature, schedule ? "createTimedAllocation" : "createAllocation", calldata, amount);
      },
      catch: () => new HttpApiError.BadRequest(),
    });
  }))
  .handle("setMandate", ({ payload }) => Effect.gen(function* () {
    const context = yield* ownerSpace(payload.draftId);
    return yield* Effect.tryPromise({
      try: async () => {
        const registryConfig = process.env.ENSV2_REGISTRY_ADDRESS;
        if (!registryConfig || !isAddress(registryConfig)) throw new Error("ENSv2 registry not configured");
        const registry = getAddress(payload.registry);
        const config = { agent: getAddress(payload.agent), registry, nameId: uint(payload.nameId),
          expectedResource: uint(payload.expectedResource), dailyCap: uint(payload.dailyCap),
          maxPerPayment: uint(payload.maxPerPayment), expiry: uint(payload.expiry, 64n) };
        if (registry.toLowerCase() !== registryConfig.toLowerCase() || config.agent === zeroAddress ||
          config.expectedResource === 0n || config.dailyCap === 0n || config.maxPerPayment === 0n ||
          config.maxPerPayment > config.dailyCap || config.expiry <= context.block.timestamp) {
          throw new Error("Invalid mandate terms");
        }
        const allocationId = uint(payload.allocationId);
        const [allocation, nextId, authorized] = await Promise.all([
          publicClient.readContract({ address: context.space, abi: spaceAccountAbi, functionName: "allocations",
            args: [allocationId], blockNumber: context.block.number }),
          publicClient.readContract({ address: context.space, abi: spaceAccountAbi, functionName: "nextAllocationId",
            blockNumber: context.block.number }),
          publicClient.readContract({ address: context.adapter, abi: ensPermissionAdapterAbi, functionName: "isAuthorized",
            args: [registry, config.nameId, config.expectedResource, config.agent], blockNumber: context.block.number }),
        ]);
        if (allocationId === 0n || allocationId >= nextId || allocation[6] || allocation[0] !== zeroAddress || !authorized) {
          throw new Error("Allocation or ENS authority unavailable");
        }
        const permit = await makePermit(context, payload.requestKey, PermitAction.SetMandate,
          allocationId, config.agent, 0n, hashMandateTerms(config));
        if (permit.expiry > config.expiry) permit.expiry = config.expiry;
        const signature = await signSpacePermit(context.signer, context.space, permit);
        const args = [allocationId, config, permit, signature] as const;
        await publicClient.simulateContract({ address: context.space, abi: spaceAccountAbi,
          functionName: "setMandate", args, account: context.actor });
        return envelope(context, permit, signature, "setMandate",
          encodeFunctionData({ abi: spaceAccountAbi, functionName: "setMandate", args }), 0n);
      },
      catch: () => new HttpApiError.BadRequest(),
    });
  })));
