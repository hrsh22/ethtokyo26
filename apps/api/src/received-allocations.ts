import { parseAbiItem, getAddress, zeroAddress, type Hex } from "viem";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { spaceAccountAbi } from "@accord/chain";
import { historyClient } from "./chain";
import type { DatabaseClient } from "./db";
import { agentPolicies, receivedAllocations, spaceDrafts } from "./db/schema";

const created = parseAbiItem("event AllocationCreated(uint256 indexed allocationId, address indexed beneficiary, uint256 amount)");
const range = 5_000n;

/** Discover both roles separately, even when a person and agent share one wallet. */
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
  const allowances: { kind: "person" | "agent"; spaceAddress: `0x${string}`; allocationId: string; spaceName: string; createdBlock?: string }[] = rows.map((row) => ({
      kind: "person",
      spaceAddress: getAddress(row.spaceAddress), allocationId: row.allocationId,
      spaceName: names.get(row.spaceAddress.toLowerCase()) ?? "Space",
      createdBlock: row.createdBlock,
    }));
  // Policies include prepared grants. Only show budgets whose current onchain
  // mandate actually names this wallet; a reassigned budget belongs to its new signer.
  const policies = await db.select().from(agentPolicies)
    .where(sql`lower(${agentPolicies.agent}) = ${beneficiary.toLowerCase()}`);
  const candidates = new Map(policies.map((policy) => [`${policy.spaceAddress.toLowerCase()}:${policy.allocationId}`, policy]));
  await Promise.all([...candidates.values()].map(async (policy) => {
    if (!names.has(policy.spaceAddress.toLowerCase())) return;
    const address = getAddress(policy.spaceAddress);
    const at = { address, abi: spaceAccountAbi, args: [BigInt(policy.allocationId)], blockNumber: head } as const;
    const [allocation, mandate] = await Promise.all([
      historyClient.readContract({ ...at, functionName: "allocations" }),
      historyClient.readContract({ ...at, functionName: "mandates" }),
    ]);
    if (allocation[0] !== zeroAddress || mandate[0] === zeroAddress || mandate[0].toLowerCase() !== beneficiary.toLowerCase()) return;
    // Revoked, expired and exhausted budgets stay discoverable with their current status.
    const draft = drafts.find((item) => item.spaceAddress?.toLowerCase() === address.toLowerCase())!;
    allowances.push({ kind: "agent", spaceAddress: address, allocationId: policy.allocationId,
      spaceName: draft.name });
  }));
  // Group each Space's roles together, newest Space and allocation first.
  const deployed = new Map(drafts.map((draft) => [draft.spaceAddress?.toLowerCase(), BigInt(draft.deploymentBlock ?? "0")]));
  return allowances.sort((a, b) => a.spaceAddress === b.spaceAddress
    ? Number(BigInt(b.allocationId) - BigInt(a.allocationId))
    : Number((deployed.get(b.spaceAddress.toLowerCase()) ?? 0n) - (deployed.get(a.spaceAddress.toLowerCase()) ?? 0n)) || a.spaceAddress.localeCompare(b.spaceAddress));
}
