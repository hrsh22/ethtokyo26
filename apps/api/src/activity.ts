import { AccordApi } from "@accord/api-contract";
import { spaceAccountAbi } from "@accord/chain";
import { HttpApiBuilder, HttpApiError } from "@effect/platform";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { decodeEventLog, getAddress, type Hex } from "viem";
import { historyClient } from "./chain";
import { Database } from "./db";
import { databaseOperation } from "./db/run";
import { spaceDrafts } from "./db/schema";

// Only public contract events are exposed; drafts, World sessions and risk requests stay private.
export const ActivityLive = HttpApiBuilder.group(AccordApi, "activity", (handlers) => handlers
  .handle("list", ({ payload }) => Effect.gen(function* () {
    const db = yield* Database;
    const address = getAddress(payload.spaceAddress);
    const [draft] = yield* databaseOperation(() => db.client.select().from(spaceDrafts)
      .where(eq(spaceDrafts.spaceAddress, address)).limit(1));
    if (!draft?.deploymentTx || !draft.activatedAt) return yield* Effect.fail(new HttpApiError.NotFound());
    const head = yield* Effect.tryPromise({ try: () => historyClient.getBlockNumber({ cacheTime: 0 }), catch: () => new HttpApiError.ServiceUnavailable() });
    // Older rows predate the saved block. Look it up once, then keep it: public
    // RPCs may stop serving receipts for older transactions.
    const deployedAt = draft.deploymentBlock ? BigInt(draft.deploymentBlock) : yield* Effect.tryPromise({
      try: () => historyClient.getTransactionReceipt({ hash: draft.deploymentTx as Hex }).then((receipt) => receipt.blockNumber),
      catch: () => new HttpApiError.ServiceUnavailable(),
    });
    if (!draft.deploymentBlock) yield* databaseOperation(() => db.client.update(spaceDrafts)
      .set({ deploymentBlock: deployedAt.toString() }).where(eq(spaceDrafts.id, draft.id)));
    const deployed = { blockNumber: deployedAt };
    return yield* Effect.tryPromise({ try: async () => {
      const requested = payload.beforeBlock === undefined ? head : BigInt(payload.beforeBlock);
      const toBlock = requested < head ? requested : head;
      if (toBlock < deployed.blockNumber) return { fromBlock: toBlock.toString(), toBlock: toBlock.toString(), deploymentTx: draft.deploymentTx!, events: [] };
      const fromBlock = toBlock - deployed.blockNumber >= 4999n ? toBlock - 4999n : deployed.blockNumber;
      const logs = await historyClient.getLogs({ address, fromBlock, toBlock });
      const events = logs.flatMap((log) => {
        try {
          const event = decodeEventLog({ abi: spaceAccountAbi, data: log.data, topics: log.topics });
          if (event.eventName === "EIP712DomainChanged") return [];
          const args = event.args;
          return [{ id: `${log.transactionHash}:${log.logIndex}`, kind: event.eventName,
            allocationId: args.allocationId.toString(), transactionHash: log.transactionHash!, blockNumber: log.blockNumber!.toString(),
            ...("amount" in args ? { amount: args.amount.toString() } : {}),
            ...("agent" in args ? { actor: args.agent } : "person" in args ? { actor: args.person } : "beneficiary" in args ? { actor: args.beneficiary } : {}),
            ...("recipient" in args ? { recipient: args.recipient } : {}) }];
        } catch { return []; }
      }).reverse();
      return { fromBlock: fromBlock.toString(), toBlock: toBlock.toString(), deploymentTx: draft.deploymentTx!, events,
        ...(fromBlock > deployed.blockNumber ? { nextBeforeBlock: (fromBlock - 1n).toString() } : {}) };
    }, catch: () => new HttpApiError.ServiceUnavailable() });
  })));
