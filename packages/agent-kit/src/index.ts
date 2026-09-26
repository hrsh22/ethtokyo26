import { accordForwarderAbi, ensPermissionAdapterAbi, spaceAccountAbi, type SpacePermit } from "@accord/chain";
import { createPublicClient, encodeFunctionData, getAddress, http, keccak256, toBytes, zeroHash, type Hex, type LocalAccount } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { lstat } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
import { AgentHttp, defaultApiUrl, defaultWebOrigin } from "./http";
import { loadPrivate, savePrivate, withFileLock } from "./store";
import { AccordError, type AgentIdentity, type AgentOptions, type Operation, type Pairing, type PairingStatus, type Quote, type ResearchInput, type Service } from "./types";
export * from "./types";

const rpcDefault = "https://ethereum-sepolia-rpc.publicnode.com";
const resolver = "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe";
const chainClient = (rpcUrl?: string) => createPublicClient({ chain: sepolia, transport: http(rpcUrl ?? rpcDefault, { timeout: 12_000 }) });
type Chain = ReturnType<typeof chainClient>;
type EndpointOptions = { apiUrl?: string; rpcUrl?: string; webOrigin?: string };
type Forward = { from: Hex; to: Hex; value: string; gas: string; nonce: string; deadline: string; data: Hex; signature: Hex };
type Journal = { operation?: Operation; forward?: Forward };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function operationId(id: string) { if (!uuid.test(id)) throw new AccordError("invalid_operation", "Use the quote ID returned by Accord."); return id; }

async function verifyIdentity(chain: Chain, identity: AgentIdentity, expectedName: string, signer?: LocalAccount) {
  if (await chain.getChainId() !== 11155111 || identity.chainId !== 11155111) throw new AccordError("wrong_network", "Use Ethereum Sepolia for this connection.");
  if (normalize(identity.name) !== normalize(expectedName) || (signer && getAddress(identity.agent) !== getAddress(signer.address))) {
    throw new AccordError("signer_mismatch", "The ENS agent name does not belong to this local signer.");
  }
  const block = await chain.getBlock(), address = getAddress(identity.spaceAddress), at = { address, abi: spaceAccountAbi, blockNumber: block.number } as const;
  const [resolved, resolvedSpace, mandate, token, forwarder, adapter, authorizer, authorized] = await Promise.all([
    chain.getEnsAddress({ name: normalize(identity.name), universalResolverAddress: resolver, blockNumber: block.number }),
    chain.getEnsAddress({ name: normalize(identity.name.split(".").slice(1).join(".")), universalResolverAddress: resolver, blockNumber: block.number }),
    chain.readContract({ ...at, functionName: "mandates", args: [BigInt(identity.allocationId)] }),
    chain.readContract({ ...at, functionName: "token" }), chain.readContract({ ...at, functionName: "trustedForwarder" }),
    chain.readContract({ ...at, functionName: "ensAdapter" }), chain.readContract({ ...at, functionName: "authorizer" }),
    chain.readContract({ address: getAddress(identity.adapterAddress), abi: ensPermissionAdapterAbi, functionName: "isAuthorized",
      args: [getAddress(identity.registry), BigInt(identity.nameId), BigInt(identity.resource), getAddress(identity.agent)], blockNumber: block.number }),
  ]);
  if (!resolved || getAddress(resolved) !== getAddress(identity.agent) || !resolvedSpace || getAddress(resolvedSpace) !== address ||
    getAddress(mandate[0]) !== getAddress(identity.agent) || getAddress(mandate[1]) !== getAddress(identity.registry) ||
    mandate[2].toString() !== identity.nameId || mandate[3].toString() !== identity.resource ||
    getAddress(token) !== getAddress(identity.tokenAddress) || getAddress(forwarder) !== getAddress(identity.forwarderAddress) ||
    getAddress(adapter) !== getAddress(identity.adapterAddress) || getAddress(authorizer) !== getAddress(identity.authorizerAddress)) {
    throw new AccordError("identity_changed", "ENS resolution and the onchain mandate do not match this connection.");
  }
  if (!identity.active || !authorized || !mandate[9] || mandate[8] <= block.timestamp) throw new AccordError("ens_revoked", "The agent's authority is revoked, inactive or expired.");
}

export async function resolveAgent(name: string, options: EndpointOptions = {}): Promise<AgentIdentity[]> {
  const api = new AgentHttp(options.apiUrl), chain = chainClient(options.rpcUrl);
  const { identities } = await api.public<{ identities: AgentIdentity[] }>("/v1/toolkit/resolve", { name: normalize(name) });
  for (const identity of identities) await verifyIdentity(chain, identity, name);
  return identities;
}

export function pairingClient(options: EndpointOptions & { signer: LocalAccount }) {
  const api = new AgentHttp(options.apiUrl, options.signer, undefined, options.webOrigin);
  return {
    start: (agentName?: string) => api.call<Pairing>("/v1/toolkit/pair", { ...(agentName ? { name: normalize(agentName) } : {}) }),
    poll: (pairing: Pick<Pairing, "id" | "pollToken">) => api.call<PairingStatus>("/v1/toolkit/pair/poll", pairing),
  };
}

export class AgentClient {
  private api: AgentHttp;
  private chain: Chain;
  private directory: string;
  private lockDirectory: string;
  constructor(private options: AgentOptions) {
    this.api = new AgentHttp(options.apiUrl, options.signer, options.connectionId, options.webOrigin);
    this.chain = chainClient(options.rpcUrl);
    const base = options.stateDirectory ?? join(homedir(), ".config", "accord", "state");
    const scope = createHash("sha256").update(`${options.apiUrl ?? defaultApiUrl}:${options.connectionId}`).digest("hex");
    this.directory = join(base, scope);
    // All profiles sharing a signer use one lock, including profiles for different allocations.
    this.lockDirectory = join(homedir(), ".config", "accord", "signer-locks");
  }
  private path(id: string) { return join(this.directory, `${operationId(id)}.json`); }
  async getIdentity() {
    const identity = await this.api.call<AgentIdentity>("/v1/toolkit/identity");
    await verifyIdentity(this.chain, identity, this.options.agentName, this.options.signer);
    const path = join(this.directory, "identity.json"), previous = await loadPrivate<AgentIdentity>(path);
    if (previous && ["name", "chainId", "agent", "spaceAddress", "allocationId", "registry", "nameId", "resource"].some(key =>
      String(previous[key as keyof AgentIdentity]).toLowerCase() !== String(identity[key as keyof AgentIdentity]).toLowerCase())) {
      throw new AccordError("identity_changed", "The saved ENS identity changed. Review and create a new connection.");
    }
    await savePrivate(path, identity); return identity;
  }
  async getBudget() {
    const i = await this.getIdentity();
    return { agentName: i.name, currency: "tUSDC", decimals: 6, remaining: i.remaining, dailyRemaining: i.dailyRemaining,
      dailyCap: i.dailyCap, maxPerPayment: i.maxPerPayment, approvalThreshold: i.approvalThreshold, expiry: i.expiry };
  }
  async listServices() { return (await this.api.call<{ services: Service[] }>("/v1/toolkit/services")).services; }
  async getQuote(input: ResearchInput) {
    operationId(input.operationKey);
    // The server stores the quote before responding. Only the serialized purchase
    // path writes the local submission journal, so reads/requotes cannot erase it.
    return this.api.call<Quote>("/v1/toolkit/quotes", { ...input, criteria: input.criteria ?? [] });
  }
  async listOperations() { return (await this.api.call<{ operations: Operation[] }>("/v1/toolkit/operations")).operations; }
  async getOperation(id: string) {
    let operation = await this.api.call<Operation>("/v1/toolkit/operation", { id: operationId(id) });
    const saved = await loadPrivate<Journal>(this.path(id));
    // Recover a locally known hash even if the server restarted before persisting it.
    // A missing HTTP response or receipt never authorizes a second purchase.
    if (!operation.transactionHash && saved?.operation?.transactionHash) {
      const hash = saved.operation.transactionHash;
      const receipt = await this.chain.getTransactionReceipt({ hash }).catch(() => null);
      if (receipt?.status === "reverted") throw new AccordError("payment_reverted", "The submitted payment reverted. Inspect it before starting a new purchase.");
      operation = receipt ? await this.api.call<Operation>("/v1/toolkit/redeem", { id, transactionHash: hash })
        : { ...operation, status: "submitted", transactionHash: hash };
    }
    return operation;
  }
  async getReceipt(id: string) {
    const op = await this.getOperation(id);
    if (!["confirmed", "delivered"].includes(op.status) || !op.transactionHash) throw new AccordError("payment_pending", "This purchase does not have a confirmed payment yet.");
    return { quoteId: op.quote.id, agentName: op.quote.agentName, amount: op.quote.amount, decimals: 6, token: op.quote.tokenAddress,
      recipient: op.quote.recipient, transactionHash: op.transactionHash, explorerUrl: `https://sepolia.etherscan.io/tx/${op.transactionHash}` };
  }
  async getResult(id: string) {
    let op = await this.getOperation(id);
    if (op.status === "confirmed" && op.transactionHash) op = await this.api.call<Operation>("/v1/toolkit/redeem", { id, transactionHash: op.transactionHash });
    if (op.status !== "delivered") throw new AccordError("result_pending", "The result is available after this quote's payment confirms.");
    return op.result;
  }
  disconnect() { return this.api.call<{ disconnected: boolean }>("/v1/toolkit/disconnect", { id: this.options.connectionId }); }
  purchase(input: { quoteId: string; operationKey: string }) {
    return this.resumeOperation(input.quoteId, input.operationKey);
  }
  async resumeOperation(id: string, expectedKey?: string): Promise<Operation> {
    return withFileLock(this.lockDirectory, `${11155111}:${this.options.signer.address.toLowerCase()}`, async () => {
      let operation = await this.getOperation(id), q = operation.quote;
      if (expectedKey && q.operationKey !== expectedKey) throw new AccordError("quote_mismatch", "This purchase belongs to another operation key.");
      if (operation.status === "confirmed" && operation.transactionHash) {
        operation = await this.api.call<Operation>("/v1/toolkit/redeem", { id, transactionHash: operation.transactionHash });
        await savePrivate(this.path(id), { operation }); return operation;
      }
      if (["delivered", "denied", "cancelled", "expired", "invalidated", "submitted", "reconciling"].includes(operation.status)) return operation;
      const identity = await this.getIdentity();
      if (q.agentName !== identity.name || getAddress(q.spaceAddress) !== getAddress(identity.spaceAddress) || q.allocationId !== identity.allocationId ||
        getAddress(q.tokenAddress) !== getAddress(identity.tokenAddress)) throw new AccordError("quote_mismatch", "The quote does not match the connected ENS agent and Space.");
      let permission: { spaceAddress: Hex; signature: Hex; permit: Record<keyof SpacePermit, string | number> };
      try {
        permission = await this.api.call("/v1/permits/payments", { draftId: q.draftId, allocationId: q.allocationId, amount: q.amount, recipient: q.recipient, requestKey: q.id });
      } catch (error) {
        if (error instanceof AccordError && error.code === "AgentApprovalRequired") return this.getOperation(id);
        throw error;
      }
      const p = permission.permit;
      if (getAddress(permission.spaceAddress) !== getAddress(identity.spaceAddress) || getAddress(String(p.actor)) !== getAddress(this.options.signer.address) ||
        Number(p.action) !== 3 || String(p.allocationId) !== q.allocationId || String(p.amount) !== q.amount || getAddress(String(p.recipient)) !== getAddress(q.recipient) ||
        p.requestId !== keccak256(toBytes(q.id)) || p.detailsHash !== zeroHash || !permission.signature) {
        throw new AccordError("permit_mismatch", "The permission does not match the exact requested purchase.");
      }
      const permit: SpacePermit = { actor: getAddress(String(p.actor)), action: 3, allocationId: BigInt(p.allocationId), amount: BigInt(p.amount),
        recipient: getAddress(String(p.recipient)), requestId: p.requestId as Hex, nonce: BigInt(p.nonce), expiry: BigInt(p.expiry),
        policyVersion: BigInt(p.policyVersion), detailsHash: p.detailsHash as Hex };
      const data = encodeFunctionData({ abi: spaceAccountAbi, functionName: "pay", args: [permit.allocationId, permit.recipient, permit.amount, permit, permission.signature] });
      const saved = await loadPrivate<Journal>(this.path(id));
      let forward = saved?.forward;
      const nonce = await this.chain.readContract({ address: identity.forwarderAddress, abi: accordForwarderAbi, functionName: "nonces", args: [this.options.signer.address] });
      if (forward && (forward.data !== data || BigInt(forward.nonce) !== nonce || Number(forward.deadline) <= Date.now() / 1000)) {
        throw new AccordError("submission_uncertain", "A previous submission needs reconciliation. Inspect the operation before retrying; do not create another purchase.");
      }
      if (!forward) {
        const deadline = Math.min(Math.floor(Date.now() / 1000) + 300, Number(permit.expiry)), gas = 1_500_000n;
        const message = { from: this.options.signer.address, to: identity.spaceAddress, value: 0n, gas, nonce, deadline, data };
        const signature = await this.options.signer.signTypedData({ domain: { name: "AccordForwarder", version: "1", chainId: 11155111, verifyingContract: identity.forwarderAddress },
          types: { ForwardRequest: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
            { name: "gas", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" }, { name: "data", type: "bytes" }] },
          primaryType: "ForwardRequest", message });
        forward = { ...message, gas: gas.toString(), nonce: nonce.toString(), deadline: String(deadline), value: "0", signature };
        await savePrivate(this.path(id), { operation, forward });
      }
      const { transactionHash } = await this.api.call<{ transactionHash: Hex }>("/v1/sponsor/relay", forward);
      operation = { ...operation, status: "submitted", transactionHash };
      await savePrivate(this.path(id), { operation, forward }); return operation;
    });
  }
}

/** Validate the ENS identity and signer before exposing spending tools. */
export async function connect(options: AgentOptions) { const agent = new AgentClient(options); await agent.getIdentity(); return agent; }
/** Reuse the private profile paired through `accord connect`, without handling its key. */
export async function connectProfile(name = "default") {
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(name)) throw new AccordError("invalid_profile", "Use a profile name created by accord init.");
  const path = join(homedir(), ".config", "accord", "profiles", `${name}.json`);
  const info = await lstat(path).catch(() => null);
  if (!info || info.isSymbolicLink() || (process.platform !== "win32" && (info.mode & 0o077))) throw new AccordError("profile_permissions", "Create a private profile with accord init, then accord connect.");
  const p = await loadPrivate<{ version: number; privateKey: Hex; connectionId?: string; agentName?: string; apiUrl: string; webOrigin: string; rpcUrl?: string }>(path);
  if (p?.version !== 1 || !p.connectionId || !p.agentName || !/^0x[a-f0-9]{64}$/i.test(p.privateKey)) throw new AccordError("not_connected", "Finish accord connect before using this profile.");
  return connect({ ...p, agentName: p.agentName, connectionId: p.connectionId, signer: privateKeyToAccount(p.privateKey) });
}
export { defaultApiUrl, defaultWebOrigin };
