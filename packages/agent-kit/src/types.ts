import type { Address, Hex, LocalAccount } from "viem";

export interface AgentIdentity {
  name: string; chainId: 11155111; agent: Address; owner: Address; draftId: string; spaceAddress: Address;
  spaceName: string; allocationId: string; registry: Address; nameId: string; resource: string; blockNumber: string;
  tokenAddress: Address; adapterAddress: Address; authorizerAddress: Address; forwarderAddress: Address;
  remaining: string; dailyRemaining: string; dailyCap: string; maxPerPayment: string; approvalThreshold: string;
  expiry: string; active: boolean;
}
export interface Quote {
  id: string; operationKey: string; agentName: string; service: string; title: string;
  tier: "snapshot" | "comparison"; repositories: string[]; criteria: string[];
  draftId: string; allocationId: string; spaceAddress: Address; tokenAddress: Address; recipient: Address;
  amount: string; expiresAt: string; collectedAt: string;
}
export interface Operation {
  quote: Quote; status: "quoted" | "awaiting_approval" | "ready" | "submitted" | "reconciling" | "confirmed" | "delivered" | "denied" | "cancelled" | "expired" | "invalidated";
  transactionHash: Hex | null; approvalId: string | null; reviewUrl: string | null; result?: unknown;
}
export interface ResearchInput {
  operationKey: string; repositories: string[]; tier: "snapshot" | "comparison"; criteria?: string[];
}
export interface AgentOptions {
  signer: LocalAccount; agentName: string; connectionId: string;
  apiUrl?: string; webOrigin?: string; rpcUrl?: string; stateDirectory?: string;
}
export interface Pairing { id: string; reviewUrl: string; pollToken: string; expiresAt: string }
export interface PairingStatus { id: string; agent: Address; name: string | null; expiresAt: string; connectionId: string | null }
export interface Service { id: string; title: string; tier: "snapshot" | "comparison"; amount: string; description: string }

export class AccordError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) { super(message); this.name = "AccordError"; }
}
