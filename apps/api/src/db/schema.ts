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
  kind: text("kind").notNull().default("browser"),
  connectionId: text("connection_id"),
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
  service: text("service").notNull().default("space-report"),
  terms: text("terms"),
  result: text("result"),
  connectionId: text("connection_id"),
  operationKey: text("operation_key"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("research_quotes_connection_operation").on(t.connectionId, t.operationKey)]);

export const agentConnections = sqliteTable("agent_connections", {
  id: text("id").primaryKey(), owner: text("owner").notNull(), agent: text("agent").notNull(),
  draftId: text("draft_id").notNull(), spaceAddress: text("space_address").notNull(),
  allocationId: text("allocation_id").notNull(), name: text("name").notNull(),
  registry: text("registry").notNull(), nameId: text("name_id").notNull(), resource: text("resource").notNull(),
  expiresAt: timestamp("expires_at").notNull(), revokedAt: timestamp("revoked_at"),
  lastSeenAt: timestamp("last_seen_at"), createdAt: createdAt(),
}, (t) => [index("agent_connections_allocation").on(t.spaceAddress, t.allocationId)]);

export const agentPairings = sqliteTable("agent_pairings", {
  id: text("id").primaryKey(), agent: text("agent").notNull(), name: text("name"),
  reviewHash: text("review_hash").notNull(), pollHash: text("poll_hash").notNull(),
  connectionId: text("connection_id"), expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"), createdAt: createdAt(),
});

// Save a sponsored payment's hash before returning to the client. A timed-out
// client can reconcile this record and the consumed request event without repaying.
export const agentSubmissions = sqliteTable("agent_submissions", {
  requestId: text("request_id").primaryKey(), connectionId: text("connection_id").notNull(),
  transactionHash: text("transaction_hash").notNull(), createdAt: createdAt(),
});

// OIDC subjects are private to the backend and separate from IDKit sessions.
export const ownerIdentities = sqliteTable("owner_identities", {
  address: text("address").primaryKey(), id: text("id").notNull(),
  issuer: text("issuer").notNull(), subject: text("subject").notNull(),
  createdAt: createdAt(),
});

export const agentRequests = sqliteTable("agent_requests", {
  id: text("id").primaryKey(), kind: text("kind").notNull(),
  owner: text("owner").notNull(), actor: text("actor").notNull(),
  draftId: text("draft_id").notNull(), spaceAddress: text("space_address").notNull(),
  allocationId: text("allocation_id").notNull(), requestKey: text("request_key").notNull(),
  payload: text("payload").notNull(), policyVersion: text("policy_version").notNull(),
  status: text("status").notNull().default("pending"),
  identityId: text("identity_id"), verifiedAt: timestamp("verified_at"),
  verificationSession: text("verification_session"),
  expiresAt: timestamp("expires_at").notNull(),
  envelope: text("envelope"), permitIntentId: text("permit_intent_id"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("agent_requests_actor_key").on(t.actor, t.requestKey), index("agent_requests_owner").on(t.owner)]);

export const worldAuthorizations = sqliteTable("world_authorizations", {
  stateHash: text("state_hash").primaryKey(), requestId: text("request_id").notNull(),
  sessionHash: text("session_hash").notNull(), owner: text("owner").notNull(),
  nonce: text("nonce").notNull(), verifier: text("verifier").notNull(),
  expiresAt: timestamp("expires_at").notNull(), consumedAt: timestamp("consumed_at"),
  createdAt: createdAt(),
});

export const spaceNamespaces = sqliteTable("space_namespaces", {
  spaceAddress: text("space_address").primaryKey(), draftId: text("draft_id").notNull(),
  name: text("name").notNull(), registry: text("registry").notNull(),
  createdAt: createdAt(),
});

export const agentPolicies = sqliteTable("agent_policies", {
  requestId: text("request_id").primaryKey(), spaceAddress: text("space_address").notNull(),
  allocationId: text("allocation_id").notNull(),
  name: text("name").notNull(), agent: text("agent").notNull(),
  registry: text("registry").notNull(), nameId: text("name_id").notNull(), resource: text("resource").notNull(),
  dailyCap: text("daily_cap").notNull(), maxPerPayment: text("max_per_payment").notNull(),
  approvalThreshold: text("approval_threshold").notNull(), expiry: text("expiry").notNull(),
  permitRequestId: text("permit_request_id").notNull(),
  revokedAt: timestamp("revoked_at"), createdAt: createdAt(),
}, (t) => [index("agent_policies_allocation").on(t.spaceAddress, t.allocationId)]);

// Persist predicted proxy addresses before broadcasting; retries recover receipts.
export const namespaceDeployments = sqliteTable("namespace_deployments", {
  id: text("id").primaryKey(), address: text("address").notNull(),
  transactionHash: text("transaction_hash"), createdAt: createdAt(),
});
