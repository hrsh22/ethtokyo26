import { parseAbiItem, getAddress, zeroAddress, type Hex } from "viem";
import { and, eq, isNotNull } from "drizzle-orm";
import { historyClient } from "./chain";
import type { DatabaseClient } from "./db";
import { receivedAllocations, spaceDrafts } from "./db/schema";

const created = parseAbiItem("event AllocationCreated(uint256 indexed allocationId, address indexed beneficiary, uint256 amount)");
const range = 5_000n;

/** Index contract events so recipients can discover existing allowances. */
export async function listReceivedAllocations(db: DatabaseClient, beneficiary: string) {
  const drafts = await db.select().from(spaceDrafts)
    .where(and(isNotNull(spaceDrafts.spaceAddress), isNotNull(spaceDrafts.activatedAt)));
  const head = await historyClient.getBlockNumber({ cacheTime: 0 });

  for (const draft of drafts) {
    if (!draft.spaceAddress || !draft.deploymentTx) continue;
    const address = getAddress(draft.spaceAddress);
    let deployedAt = draft.deploymentBlock ? BigInt(draft.deploymentBlock) : undefined;
    if (deployedAt === undefined) {
      const receipt = await historyClient.getTransactionReceipt({ hash: draft.deploymentTx as Hex });
      deployedAt = receipt.blockNumber;
      await db.update(spaceDrafts).set({ deploymentBlock: deployedAt.toString() }).where(eq(spaceDrafts.id, draft.id));
    }
    let fromBlock = draft.allocationScanBlock ? BigInt(draft.allocationScanBlock) + 1n : deployedAt;
    while (fromBlock <= head) {
      const toBlock = fromBlock + range - 1n < head ? fromBlock + range - 1n : head;
      const logs = await historyClient.getLogs({ address, event: created, fromBlock, toBlock });
      await db.transaction(async (tx) => {
        for (const log of logs) {
          if (!log.args.beneficiary || log.args.beneficiary === zeroAddress || !log.args.allocationId || !log.blockNumber) continue;
          await tx.insert(receivedAllocations).values({
            spaceAddress: address,
            allocationId: log.args.allocationId.toString(),
            beneficiary: log.args.beneficiary.toLowerCase(),
            createdBlock: log.blockNumber.toString(),
          }).onConflictDoNothing();
        }
        await tx.update(spaceDrafts).set({ allocationScanBlock: toBlock.toString() }).where(eq(spaceDrafts.id, draft.id));
      });
      fromBlock = toBlock + 1n;
    }
  }

  const rows = await db.select().from(receivedAllocations)
    .where(eq(receivedAllocations.beneficiary, beneficiary.toLowerCase()));
  const names = new Map(drafts.filter((draft) => draft.spaceAddress)
    .map((draft) => [draft.spaceAddress!.toLowerCase(), draft.name]));
  return rows.sort((a, b) => Number(BigInt(b.createdBlock) - BigInt(a.createdBlock)))
    .map((row) => ({
      spaceAddress: getAddress(row.spaceAddress), allocationId: row.allocationId,
      spaceName: names.get(row.spaceAddress.toLowerCase()) ?? "Space",
      createdBlock: row.createdBlock,
    }));
}
