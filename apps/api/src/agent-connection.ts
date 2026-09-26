import { ToolkitError } from "@accord/api-contract";
import { ensPermissionAdapterAbi, spaceAccountAbi } from "@accord/chain";
import { desc, eq } from "drizzle-orm";
import { getAddress, isAddress, zeroAddress, type Hex } from "viem";
import { labelhash, namehash, normalize } from "viem/ens";
import { adapterAddress, permitSigner, publicClient } from "./chain";
import type { DatabaseClient } from "./db";
import { agentConnections, agentPolicies, spaceDrafts } from "./db/schema";
import { ensRegistryAbi, ensResolverAbi } from "./ens-v2";

export const toolkitError = (code: string, message: string) => new ToolkitError({ code, message });
export function agentName(input: string) {
  let name: string;
  try { name = normalize(input.trim()); } catch { throw toolkitError("invalid_name", "Enter the agent's full ENS name."); }
  const parent = process.env.ENS_NAMESPACE_NAME;
  if (!parent || name.length > 255 || !name.endsWith(`.${parent}`) || name.split(".").length !== parent.split(".").length + 2) {
    throw toolkitError("unsupported_identity", "Use an agent name issued by an Accord Space on Sepolia.");
  }
  return name;
}

export async function resolveAgent(db: DatabaseClient, input: string) {
  const name = agentName(input);
  const configured = process.env.ENSV2_REGISTRY_ADDRESS;
  const forwarder = process.env.FORWARDER_ADDRESS;
  const token = process.env.DEMO_TOKEN_ADDRESS;
  if (!configured || !isAddress(configured) || !forwarder || !isAddress(forwarder) || !token || !isAddress(token)) {
    throw toolkitError("service_unavailable", "The agent service is not configured.");
  }
  if (await publicClient.getChainId() !== 11155111) throw toolkitError("wrong_network", "Agent connections require Ethereum Sepolia.");
  const block = await publicClient.getBlock(), blockNumber = block.number;
  let registry = getAddress(configured);
  const labels = name.split(".");
  for (const label of labels.slice(1, -1).reverse()) {
    const state = await publicClient.readContract({ address: registry, abi: ensRegistryAbi,
      functionName: "getState", args: [BigInt(labelhash(label))], blockNumber });
    if (state.status !== 2 || state.expiry <= block.timestamp) throw toolkitError("ens_revoked", "The agent's ENS namespace is revoked or expired.");
    registry = await publicClient.readContract({ address: registry, abi: ensRegistryAbi,
      functionName: "getSubregistry", args: [label], blockNumber });
    if (registry === zeroAddress) throw toolkitError("identity_changed", "The ENS namespace no longer points to this agent registry.");
  }
  const id = BigInt(labelhash(labels[0]!));
  const [state, resolver, candidates] = await Promise.all([
    publicClient.readContract({ address: registry, abi: ensRegistryAbi, functionName: "getState", args: [id], blockNumber }),
    publicClient.readContract({ address: registry, abi: ensRegistryAbi, functionName: "getResolver", args: [labels[0]!], blockNumber }),
    db.select().from(agentPolicies).where(eq(agentPolicies.name, name)).orderBy(desc(agentPolicies.createdAt)),
  ]);
  if (state.status !== 2 || state.expiry <= block.timestamp || resolver === zeroAddress) {
    throw toolkitError("ens_revoked", "This agent's ENS identity is revoked or expired.");
  }
  const resolved = await publicClient.readContract({ address: resolver, abi: ensResolverAbi, functionName: "addr", args: [namehash(name)], blockNumber });
  if (resolved === zeroAddress || resolved.toLowerCase() !== state.latestOwner.toLowerCase()) {
    throw toolkitError("identity_changed", "The ENS address record does not match its registered owner.");
  }
  const found = [];
  const seen = new Set<string>();
  for (const p of candidates) {
    const key = `${p.spaceAddress}:${p.allocationId}`;
    if (seen.has(key) || p.revokedAt || p.agent.toLowerCase() !== resolved.toLowerCase() ||
      p.registry.toLowerCase() !== registry.toLowerCase() || BigInt(p.nameId) !== id || BigInt(p.resource) !== state.resource) continue;
    const [draft] = await db.select().from(spaceDrafts).where(eq(spaceDrafts.spaceAddress, p.spaceAddress));
    if (!draft?.activatedAt) continue;
    const address = getAddress(p.spaceAddress), at = { address, abi: spaceAccountAbi, blockNumber } as const;
    const [allocation, mandate, owner, authorizer, actualToken, adapter, actualForwarder, consumed, authorized] = await Promise.all([
      publicClient.readContract({ ...at, functionName: "allocations", args: [BigInt(p.allocationId)] }),
      publicClient.readContract({ ...at, functionName: "mandates", args: [BigInt(p.allocationId)] }),
      publicClient.readContract({ ...at, functionName: "owner" }),
      publicClient.readContract({ ...at, functionName: "authorizer" }),
      publicClient.readContract({ ...at, functionName: "token" }),
      publicClient.readContract({ ...at, functionName: "ensAdapter" }),
      publicClient.readContract({ ...at, functionName: "trustedForwarder" }),
      publicClient.readContract({ ...at, functionName: "consumedRequests", args: [p.permitRequestId as Hex] }),
      publicClient.readContract({ address: adapterAddress(), abi: ensPermissionAdapterAbi, functionName: "isAuthorized",
        args: [registry, id, state.resource, resolved], blockNumber }),
    ]);
    if (mandate[0].toLowerCase() !== resolved.toLowerCase() || mandate[1].toLowerCase() !== registry.toLowerCase() || mandate[2] !== id || mandate[3] !== state.resource ||
      mandate[4].toString() !== p.dailyCap || mandate[5].toString() !== p.maxPerPayment || mandate[8].toString() !== p.expiry || !consumed) continue;
    if (owner.toLowerCase() !== draft.owner.toLowerCase() || authorizer.toLowerCase() !== permitSigner().address.toLowerCase() ||
      actualToken.toLowerCase() !== token.toLowerCase() || adapter.toLowerCase() !== adapterAddress().toLowerCase() || actualForwarder.toLowerCase() !== forwarder.toLowerCase()) continue;
    const spent = mandate[7] === block.timestamp / 86400n ? mandate[6] : 0n;
    seen.add(key);
    found.push({ name, chainId: 11155111 as const, agent: getAddress(resolved), owner: getAddress(owner), draftId: draft.id,
      spaceAddress: address, spaceName: draft.name, allocationId: p.allocationId, registry: getAddress(registry), nameId: id.toString(),
      resource: state.resource.toString(), blockNumber: blockNumber.toString(), tokenAddress: getAddress(actualToken),
      adapterAddress: getAddress(adapter), authorizerAddress: getAddress(authorizer), forwarderAddress: getAddress(actualForwarder),
      remaining: allocation[1].toString(), dailyRemaining: (mandate[4] > spent ? mandate[4] - spent : 0n).toString(),
      dailyCap: p.dailyCap, maxPerPayment: p.maxPerPayment, approvalThreshold: p.approvalThreshold, expiry: p.expiry,
      active: authorized && allocation[0] === zeroAddress && !allocation[6] && mandate[9] && mandate[8] > block.timestamp,
    });
  }
  if (!found.length) throw toolkitError("identity_unavailable", "No confirmed Accord delegation matches this ENS identity.");
  return found;
}

export async function connectionIdentity(db: DatabaseClient, connection: typeof agentConnections.$inferSelect) {
  const identities = await resolveAgent(db, connection.name);
  const identity = identities.find(i => i.draftId === connection.draftId && i.allocationId === connection.allocationId);
  if (!identity || identity.agent.toLowerCase() !== connection.agent || identity.registry.toLowerCase() !== connection.registry.toLowerCase() ||
    identity.nameId !== connection.nameId || identity.resource !== connection.resource || identity.spaceAddress.toLowerCase() !== connection.spaceAddress.toLowerCase()) {
    throw toolkitError("identity_changed", "This connection's agent identity changed. Reconnect after reviewing its authority.");
  }
  if (!identity.active) throw toolkitError("ens_revoked", "This agent's authority is inactive, revoked or expired.");
  return identity;
}
