import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import { useSponsoredTransaction } from "./use-sponsored-transaction";

const mocks = vi.hoisted(() => ({ read: vi.fn(), sign: vi.fn(), relay: vi.fn(), batch: vi.fn(), legacy: vi.fn(), named: true }));
const owner = `0x${"1".repeat(40)}` as const, forwarder = `0x${"2".repeat(40)}` as const;
const token = `0x${"3".repeat(40)}` as const, space = `0x${"4".repeat(40)}` as const;
const hash = `0x${"a".repeat(64)}`, signature = `0x${"b".repeat(130)}`;
vi.mock("wagmi", () => ({ usePublicClient: () => ({ readContract: mocks.read }), useSignTypedData: () => ({ signTypedDataAsync: mocks.sign }) }));
vi.mock("./accord", () => ({ SEPOLIA_CHAIN_ID: 11155111, useAccord: () => ({ account: `0x${"1".repeat(40)}`, auth: { signedIn: true },
  config: { data: { namedSpaces: mocks.named, forwarderAddress: `0x${"2".repeat(40)}` } },
  client: { executeBatch: mocks.batch, relay: mocks.relay, relayBatch: mocks.legacy },
}) }));
const envelope = { tokenAddress: token, spaceAddress: space, approvalAmount: "100", calldata: "0x12345678" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.named = true;
  mocks.read.mockImplementation(async ({ functionName }) => functionName === "trustedForwarder" ? forwarder : functionName === "nonces" ? BigInt(7) : BigInt(0));
  mocks.sign.mockResolvedValue(signature);
  for (const fn of [mocks.batch, mocks.relay, mocks.legacy]) fn.mockResolvedValue({ transactionHash: hash });
});
describe("sponsored transaction batching", () => {
  it("combines authorized ENS registration and its mandate into one signed batch", async () => {
    await useSponsoredTransaction().sendWithApproval({ ...envelope, approvalAmount: "0", preCalls: [{ to: token, data: "0xabcdef01" }] });
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    expect(mocks.batch.mock.calls[0][0].calls.map((call: { data: string }) => call.data)).toEqual(["0xabcdef01", envelope.calldata]);
    expect(mocks.read.mock.calls.some(([args]) => args.functionName === "allowance")).toBe(false);
  });

  it("signs approval and funding once, in order, with an exact allowance", async () => {
    expect(await useSponsoredTransaction().sendWithApproval(envelope)).toBe(hash);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    expect(mocks.sign).toHaveBeenCalledWith(expect.objectContaining({ primaryType: "ForwardBatch", message: expect.objectContaining({ from: owner, nonce: BigInt(7) }) }));
    const batch = mocks.batch.mock.calls[0][0];
    expect(batch.calls.map((call: { to: string }) => call.to)).toEqual([token, space]);
    expect(decodeFunctionData({ abi: erc20Abi, data: batch.calls[0].data })).toMatchObject({ functionName: "approve", args: [space, BigInt(100)] });
    expect(mocks.relay).not.toHaveBeenCalled();
  });
  it("skips approval when an existing allowance covers funding", async () => {
    mocks.read.mockImplementation(async ({ functionName }) => functionName === "trustedForwarder" ? forwarder : functionName === "nonces" ? BigInt(7) : BigInt(100));
    await useSponsoredTransaction().sendWithApproval(envelope);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    expect(mocks.relay).toHaveBeenCalledWith(expect.objectContaining({ to: space, nonce: "7" }));
    expect(mocks.batch).not.toHaveBeenCalled();
  });
  it("does not read allowance for a non-funding action", async () => {
    await useSponsoredTransaction().sendWithApproval({ ...envelope, approvalAmount: "0" });
    expect(mocks.read.mock.calls.some(([args]) => args.functionName === "allowance")).toBe(false);
    expect(mocks.relay).toHaveBeenCalledTimes(1);
  });
  it("collects consecutive legacy signatures before one atomic submission", async () => {
    mocks.named = false;
    await useSponsoredTransaction().sendWithApproval(envelope);
    expect(mocks.sign.mock.calls.map(([args]) => args.message.nonce)).toEqual([BigInt(7), BigInt(8)]);
    expect(mocks.legacy).toHaveBeenCalledTimes(1);
    expect(mocks.relay).not.toHaveBeenCalled();
  });
  it("never submits a partial batch if a wallet rejects a signature", async () => {
    mocks.named = false;
    mocks.sign.mockResolvedValueOnce(signature).mockRejectedValueOnce(new Error("Rejected"));
    await expect(useSponsoredTransaction().sendWithApproval(envelope)).rejects.toThrow("Rejected");
    expect(mocks.legacy).not.toHaveBeenCalled(); expect(mocks.relay).not.toHaveBeenCalled(); expect(mocks.batch).not.toHaveBeenCalled();
  });
  it("rejects targets with different immutable forwarders before signing", async () => {
    mocks.read.mockImplementation(async ({ address, functionName }) => functionName === "allowance" ? BigInt(0) : address === token ? forwarder : owner);
    await expect(useSponsoredTransaction().sendWithApproval(envelope)).rejects.toThrow("different gas sponsors");
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
