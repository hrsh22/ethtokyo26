import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAddress, keccak256, toBytes, zeroHash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { AgentClient, AccordError, type AgentIdentity, type Operation, type Quote } from "./index";
import { createMcpServer } from "./mcp";

const mocks = vi.hoisted(() => ({ call: vi.fn(), chain: { getChainId: vi.fn(), getBlock: vi.fn(), getEnsAddress: vi.fn(), readContract: vi.fn(), getTransactionReceipt: vi.fn() } }));
vi.mock("./http", () => ({ defaultApiUrl: "https://accord-api.hrsh.dev", defaultWebOrigin: "https://accord.hrsh.dev",
  AgentHttp: class { call = mocks.call; public = mocks.call; } }));
vi.mock("viem", async original => ({ ...await original<typeof import("viem")>(), createPublicClient: () => mocks.chain }));
const address = (n: string) => getAddress(`0x${n.repeat(40)}`);
let directory: string, agent: AgentClient, identity: AgentIdentity, quote: Quote, operation: Operation;
let nonce: bigint, relays: number, loseResponse: boolean, receiptAvailable: boolean;
const signer = privateKeyToAccount(`0x${"0".repeat(63)}7`), hash = `0x${"a".repeat(64)}` as Hex;
beforeEach(async () => {
  vi.resetAllMocks(); directory = await mkdtemp(join(tmpdir(), "accord-runtime-")); nonce = 0n; relays = 0; loseResponse = false; receiptAvailable = false;
  identity = { name: "research.team.accordspaces26.eth", chainId: 11155111, agent: signer.address, owner: address("1"), draftId: randomUUID(),
    spaceAddress: address("2"), spaceName: "Team", allocationId: "1", registry: address("3"), nameId: "42", resource: "7", blockNumber: "100",
    tokenAddress: address("4"), adapterAddress: address("5"), authorizerAddress: address("6"), forwarderAddress: address("8"), remaining: "100000000",
    dailyRemaining: "100000000", dailyCap: "100000000", maxPerPayment: "25000000", approvalThreshold: "10000000", expiry: String(Math.floor(Date.now() / 1000) + 86400), active: true };
  quote = { id: randomUUID(), operationKey: randomUUID(), agentName: identity.name, service: "repository-research", title: "Repository snapshot", tier: "snapshot",
    repositories: ["ensdomains/ens-contracts"], criteria: [], draftId: identity.draftId, allocationId: "1", spaceAddress: identity.spaceAddress, tokenAddress: identity.tokenAddress,
    recipient: address("9"), amount: "1000000", expiresAt: new Date(Date.now() + 600_000).toISOString(), collectedAt: new Date().toISOString() };
  operation = { quote, status: "quoted", transactionHash: null, approvalId: null, reviewUrl: null };
  mocks.chain.getChainId.mockResolvedValue(11155111);
  mocks.chain.getBlock.mockResolvedValue({ number: 100n, timestamp: BigInt(Math.floor(Date.now() / 1000)) });
  mocks.chain.getEnsAddress.mockImplementation(({ name }) => name === identity.name ? identity.agent : identity.spaceAddress);
  mocks.chain.readContract.mockImplementation(async ({ functionName }) => {
    const values: Record<string, unknown> = { mandates: [identity.agent, identity.registry, 42n, 7n, 100000000n, 25000000n, 0n, 0n, BigInt(identity.expiry), identity.active],
      token: identity.tokenAddress, trustedForwarder: identity.forwarderAddress, ensAdapter: identity.adapterAddress, authorizer: identity.authorizerAddress, isAuthorized: identity.active, nonces: nonce };
    return values[functionName];
  });
  mocks.chain.getTransactionReceipt.mockImplementation(async () => { if (!receiptAvailable) throw new Error("not mined"); return { status: "success" }; });
  mocks.call.mockImplementation(async (path, payload) => {
    switch (path) {
      case "/v1/toolkit/identity": return structuredClone(identity);
      case "/v1/toolkit/quotes": return structuredClone(quote);
      case "/v1/toolkit/operation": return structuredClone(operation);
      case "/v1/toolkit/operations": return { operations: [structuredClone(operation)] };
      case "/v1/permits/payments": return { spaceAddress: identity.spaceAddress, signature: "0x1234", permit: { actor: identity.agent, action: 3, allocationId: "1", amount: quote.amount,
        recipient: quote.recipient, requestId: keccak256(toBytes(quote.id)), nonce: "1", expiry: String(Math.floor(Date.now() / 1000) + 300), policyVersion: "1", detailsHash: zeroHash } };
      case "/v1/sponsor/relay":
        expect(payload.nonce).toBe(nonce.toString()); relays++; nonce++;
        operation = { ...operation, status: "submitted", transactionHash: hash };
        if (loseResponse) throw new AccordError("connection_unavailable", "Response lost");
        return { transactionHash: hash };
      case "/v1/toolkit/redeem":
        expect(payload.transactionHash).toBe(hash);
        operation = { ...operation, status: "delivered", transactionHash: hash, result: { sources: ["https://github.com/ensdomains/ens-contracts"] } };
        return structuredClone(operation);
      default: throw new Error(`Unexpected ${path}`);
    }
  });
  agent = new AgentClient({ signer, agentName: identity.name, connectionId: randomUUID(), stateDirectory: directory });
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("durable purchase runtime", () => {
  it("serializes concurrent purchases and submits the same quote only once", async () => {
    const results = await Promise.all([agent.purchase({ quoteId: quote.id, operationKey: quote.operationKey }), agent.resumeOperation(quote.id)]);
    expect(results.every(r => r.transactionHash === hash)).toBe(true); expect(relays).toBe(1);
  });
  it("recovers a lost relay response after restart without another signature or debit", async () => {
    loseResponse = true;
    await expect(agent.resumeOperation(quote.id)).rejects.toMatchObject({ code: "connection_unavailable" });
    const restarted = new AgentClient((agent as unknown as { options: ConstructorParameters<typeof AgentClient>[0] }).options);
    await agent.getQuote({ operationKey: quote.operationKey, repositories: quote.repositories, tier: "snapshot" });
    expect((await restarted.resumeOperation(quote.id)).transactionHash).toBe(hash); expect(relays).toBe(1);
    operation.status = "confirmed";
    expect((await restarted.resumeOperation(quote.id)).status).toBe("delivered");
    expect(await restarted.getResult(quote.id)).toHaveProperty("sources"); expect(relays).toBe(1);
  });
  it("retains a locally saved hash when server persistence was lost, then recovers delivery", async () => {
    await agent.resumeOperation(quote.id);
    operation = { ...operation, status: "quoted", transactionHash: null };
    expect((await agent.resumeOperation(quote.id)).status).toBe("submitted"); expect(relays).toBe(1);
    receiptAvailable = true;
    expect((await agent.resumeOperation(quote.id)).status).toBe("delivered"); expect(relays).toBe(1);
  });
  it("returns the human review URL immediately and never approves on the owner's behalf", async () => {
    const previous = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation(async (path, payload) => {
      if (path === "/v1/permits/payments") {
        operation = { ...operation, status: "awaiting_approval", approvalId: randomUUID(), reviewUrl: "https://accord.hrsh.dev/approvals/review" };
        throw new AccordError("AgentApprovalRequired", "Review required");
      }
      return previous(path, payload);
    });
    expect(await agent.resumeOperation(quote.id)).toMatchObject({ status: "awaiting_approval", reviewUrl: expect.stringContaining("/approvals/") });
    expect(relays).toBe(0);
    expect(mocks.call.mock.calls.some(([path]) => path.includes("decide"))).toBe(false);
  });
  it.each(["denied", "expired", "cancelled", "invalidated", "reconciling"] as const)("does not pay a %s operation", async status => {
    operation.status = status; expect((await agent.resumeOperation(quote.id)).status).toBe(status); expect(relays).toBe(0);
    expect(mocks.call.mock.calls.some(([path]) => path === "/v1/permits/payments")).toBe(false);
  });
  it("refuses swapped permit terms before signing a forward request", async () => {
    const previous = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation(async (path, payload) => { const value = await previous(path, payload); if (path === "/v1/permits/payments") value.permit.recipient = address("b"); return value; });
    await expect(agent.resumeOperation(quote.id)).rejects.toMatchObject({ code: "permit_mismatch" }); expect(relays).toBe(0);
  });
  it("refuses another intent's quote and revoked ENS authority", async () => {
    await expect(agent.purchase({ quoteId: quote.id, operationKey: randomUUID() })).rejects.toMatchObject({ code: "quote_mismatch" });
    identity.active = false; await expect(agent.resumeOperation(quote.id)).rejects.toMatchObject({ code: "ens_revoked" }); expect(relays).toBe(0);
  });
  it("does not deliver unpaid data", async () => { await expect(agent.getResult(quote.id)).rejects.toMatchObject({ code: "result_pending" }); expect(relays).toBe(0); });
});

it("exercises MCP discovery, strict tools, purchase and resumed result through a protocol client", async () => {
  const server = createMcpServer(agent), client = new Client({ name: "accord-protocol-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools(); expect(tools).toHaveLength(9);
    expect(tools.some(t => /sign|approve|calldata/.test(t.name))).toBe(false);
    expect(tools.find(t => t.name === "accord_purchase")?.annotations?.readOnlyHint).toBe(false);
    const bad = await client.callTool({ name: "accord_purchase", arguments: { quoteId: quote.id, operationKey: quote.operationKey, recipient: address("b") } });
    expect(bad.isError).toBe(true); expect(relays).toBe(0);
    const result = await client.callTool({ name: "accord_purchase", arguments: { quoteId: quote.id, operationKey: quote.operationKey } });
    expect(JSON.stringify(result)).toContain("submitted"); expect(relays).toBe(1);
    operation.status = "confirmed";
    expect(JSON.stringify(await client.callTool({ name: "accord_resume", arguments: { quoteId: quote.id } }))).toContain("delivered");
    expect(JSON.stringify(await client.callTool({ name: "accord_result", arguments: { quoteId: quote.id } }))).toContain("sources"); expect(relays).toBe(1);
  } finally { await client.close(); await server.close(); }
});
