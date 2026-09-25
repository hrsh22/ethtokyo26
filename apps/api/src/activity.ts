import { AccordApi } from "@accord/api-contract";
import { spaceAccountAbi } from "@accord/chain";
import { HttpApiBuilder, HttpApiError } from "@effect/platform";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { decodeEventLog, getAddress, type Hex } from "viem";
import { publicClient } from "./chain";
import { Database } from "./db";
import { databaseOperation } from "./db/run";
import { spaceDrafts } from "./db/schema";

// Only public contract events are exposed; draft titles, World sessions and risk requests stay private.
export const ActivityLive = HttpApiBuilder.group(AccordApi, "activity", (handlers) => handlers
  .handle("list", ({ payload }) => Effect.gen(function* () {
    const db = yield* Database;
    const address = getAddress(payload.spaceAddress);
    const [draft] = yield* databaseOperation(() => db.client.select().from(spaceDrafts)
      .where(eq(spaceDrafts.spaceAddress, address)).limit(1));
    if (!draft?.deploymentTx || !draft.activatedAt) return yield* Effect.fail(new HttpApiError.NotFound());
    return yield* Effect.tryPromise({ try: async () => {
      const [head, deployed] = await Promise.all([publicClient.getBlockNumber({ cacheTime: 0 }),
        publicClient.getTransactionReceipt({ hash: draft.deploymentTx as Hex })]);
      const requested = payload.beforeBlock === undefined ? head : BigInt(payload.beforeBlock);
      const toBlock = requested < head ? requested : head;
      if (toBlock < deployed.blockNumber) return { fromBlock: toBlock.toString(), toBlock: toBlock.toString(), deploymentTx: draft.deploymentTx!, events: [] };
      const fromBlock = toBlock - deployed.blockNumber >= 4999n ? toBlock - 4999n : deployed.blockNumber;
      const logs = await publicClient.getLogs({ address, fromBlock, toBlock });
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
