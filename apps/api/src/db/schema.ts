import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const createdAt = () => timestamp("created_at").default(sql`(unixepoch() * 1000)`).notNull();

export const authChallenges = sqliteTable("auth_challenges", {
  id: text("id").primaryKey(),
  address: text("address").notNull(),
  message: text("message").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  createdAt: createdAt(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  address: text("address").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: createdAt(),
});

export const spaceDrafts = sqliteTable("space_drafts", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  templateId: text("template_id").notNull(),
  spaceAddress: text("space_address").unique(),
  tokenAddress: text("token_address"),
  deploymentTx: text("deployment_tx").unique(),
  // Saved at activation: some RPCs stop serving receipts for older transactions.
  deploymentBlock: text("deployment_block"),
  allocationScanBlock: text("allocation_scan_block"),
  activatedAt: timestamp("activated_at"),
  createdAt: createdAt(),
});

// Public AllocationCreated events indexed for each activated Space. The cursor
// advances only after the events in that block range have been saved.
export const receivedAllocations = sqliteTable("received_allocations", {
  spaceAddress: text("space_address").notNull(),
  allocationId: text("allocation_id").notNull(),
  beneficiary: text("beneficiary").notNull(),
  createdBlock: text("created_block").notNull(),
}, (table) => [
  primaryKey({ columns: [table.spaceAddress, table.allocationId] }),
  index("received_allocations_beneficiary_idx").on(table.beneficiary),
]);

export const worldSessions = sqliteTable("world_sessions", {
  address: text("address").primaryKey(),
  sessionId: text("session_id").unique().notNull(),
  enrolledAt: timestamp("enrolled_at").default(sql`(unixepoch() * 1000)`).notNull(),
});

// A display snapshot, never a source of claim authority. Only show it once its
// owner-signed creation permit has been consumed and the beneficiary matches.
export const allocationNames = sqliteTable("allocation_names", {
  requestId: text("request_id").primaryKey(),
  spaceAddress: text("space_address").notNull(),
  allocationId: text("allocation_id").notNull(),
  beneficiary: text("beneficiary").notNull(),
  name: text("name").notNull(),
  resolvedBlock: text("resolved_block").notNull(),
  createdAt: createdAt(),
});

export const worldChallenges = sqliteTable("world_challenges", {
  id: text("id").primaryKey(),
  address: text("address").notNull(),
  mode: text("mode").notNull(),
  intentId: text("intent_id"),
  signalHash: text("signal_hash"),
  nonce: text("nonce").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  createdAt: createdAt(),
});

export const worldProofs = sqliteTable("world_proofs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  nullifier: text("nullifier").notNull(),
  action: text("action").notNull(),
  intentId: text("intent_id").unique(),
  verifiedAt: timestamp("verified_at").default(sql`(unixepoch() * 1000)`).notNull(),
}, (table) => [uniqueIndex("world_proofs_nullifier_action").on(table.nullifier, table.action)]);

export const permitIntents = sqliteTable("permit_intents", {
  id: text("id").primaryKey(),
  requestKey: text("request_key").notNull(),
  draftId: text("draft_id").notNull(),
  spaceAddress: text("space_address").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  allocationId: text("allocation_id").notNull(),
  recipient: text("recipient").notNull(),
  amount: text("amount").notNull(),
  requestId: text("request_id").unique().notNull(),
  nonce: text("nonce").notNull(),
  expiry: timestamp("expiry").notNull(),
  policyVersion: text("policy_version").notNull(),
  permitDigest: text("permit_digest").notNull(),
  worldVerifiedAt: timestamp("world_verified_at"),
  riskScore: text("risk_score"),
  riskTraits: text("risk_traits"),
  riskCheckedAt: timestamp("risk_checked_at"),
  signature: text("signature"),
  signedAt: timestamp("signed_at"),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("permit_intents_actor_request_key").on(table.actor, table.requestKey)]);

export const researchQuotes = sqliteTable("research_quotes", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(), draftId: text("draft_id").notNull(),
  allocationId: text("allocation_id").notNull(), spaceAddress: text("space_address").notNull(),
  tokenAddress: text("token_address").notNull(), recipient: text("recipient").notNull(),
  amount: text("amount").notNull(), expiresAt: timestamp("expires_at").notNull(),
  transactionHash: text("transaction_hash").unique(),
  createdAt: createdAt(),
});
