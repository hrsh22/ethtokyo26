import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { spaceFactoryAbi } from "@accord/chain";
import { deployedSpaceFromReceipt, publicClient } from "./chain";

const address = (digit: string) => `0x${digit.repeat(40)}` as Address;
const owner = address("1"), factory = address("2"), adapter = address("3"), token = address("4"), space = address("5"), relay = address("6");
const hash = `0x${"a".repeat(64)}` as Hex;
// Public, test-only key; never used to submit a transaction.
const signerKey = `0x${"0".repeat(63)}1` as Hex;
const authorizer = privateKeyToAccount(signerKey).address;

function createdLog(overrides: { factory?: Address; owner?: Address; authorizer?: Address } = {}) {
  return {
    address: overrides.factory ?? factory,
    topics: encodeEventTopics({ abi: spaceFactoryAbi, eventName: "SpaceCreated", args: { owner: overrides.owner ?? owner, space } }),
    data: encodeAbiParameters([{ type: "address" }, { type: "address" }], [token, overrides.authorizer ?? authorizer]),
  };
}

function receipt(overrides: Record<string, unknown> = {}) {
  return { status: "success", from: owner, to: factory, logs: [createdLog()], ...overrides } as TransactionReceipt;
}

beforeEach(() => {
  vi.stubEnv("SPACE_FACTORY_ADDRESS", factory);
  vi.stubEnv("ENS_ADAPTER_ADDRESS", adapter);
  vi.stubEnv("PERMIT_SIGNER_PRIVATE_KEY", signerKey);
  vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValue(receipt());
  vi.spyOn(publicClient, "getBytecode").mockResolvedValue("0x6000");
  vi.spyOn(publicClient, "readContract").mockImplementation(async (args) => {
    const values: Record<string, Address> = { owner, authorizer, token, ensAdapter: adapter };
    return values[args.functionName];
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Space activation receipt validation", () => {
  it("accepts a direct factory call", async () => {
    await expect(deployedSpaceFromReceipt(hash, owner)).resolves.toEqual({ space, token });
  });

  it.each([owner, relay])("accepts a wrapped smart-account call submitted by %s", async (from) => {
    // MetaMask EIP-7702 uses a top-level executor, while the trusted factory
    // creates the Space in an internal call. Bundlers may also be the sender.
    vi.mocked(publicClient.getTransactionReceipt).mockResolvedValue(receipt({ from, to: relay, type: "eip7702" }));
    await expect(deployedSpaceFromReceipt(hash, owner)).resolves.toEqual({ space, token });
  });

  it.each([
    { factory: relay }, { owner: relay }, { authorizer: relay },
  ])("rejects an event with untrusted identity: %j", async (overrides) => {
    vi.mocked(publicClient.getTransactionReceipt).mockResolvedValue(receipt({ logs: [createdLog(overrides)] }));
    await expect(deployedSpaceFromReceipt(hash, owner)).rejects.toThrow("Expected one trusted SpaceCreated event");
  });

  it("rejects ambiguous deployments", async () => {
    vi.mocked(publicClient.getTransactionReceipt).mockResolvedValue(receipt({ logs: [createdLog(), createdLog()] }));
    await expect(deployedSpaceFromReceipt(hash, owner)).rejects.toThrow("Expected one trusted SpaceCreated event");
  });

  it("rejects reverted transactions", async () => {
    vi.mocked(publicClient.getTransactionReceipt).mockResolvedValue(receipt({ status: "reverted" }));
    await expect(deployedSpaceFromReceipt(hash, owner)).rejects.toThrow();
  });

  it.each(["owner", "authorizer", "token", "ensAdapter"])("checks the deployed %s", async (field) => {
    vi.mocked(publicClient.readContract).mockImplementation(async (args) => {
      const values: Record<string, Address> = { owner, authorizer, token, ensAdapter: adapter };
      return args.functionName === field ? relay : values[args.functionName];
    });
    await expect(deployedSpaceFromReceipt(hash, owner)).rejects.toThrow("Deployed Space configuration mismatch");
  });
});
