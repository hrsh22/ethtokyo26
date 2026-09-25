import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zeroAddress, type Address, type Hex } from "viem";
import { publicClient } from "./chain";
import { confirmedRecipientLabel, normalizeRecipientName, resolveRecipientName } from "./ens-recipient";

const recipient = `0x${"1".repeat(40)}` as Address;
beforeEach(() => {
  vi.spyOn(publicClient, "getBlockNumber").mockResolvedValue(100n);
  vi.spyOn(publicClient, "getEnsAddress").mockResolvedValue(recipient);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("human ENS beneficiaries", () => {
  it("normalizes names and uses a payment record at a fixed block", async () => {
    expect(normalizeRecipientName(" Family.ETH ")).toBe("family.eth");
    await expect(resolveRecipientName("Family.ETH", 42n)).resolves.toEqual({ name: "family.eth", address: recipient, blockNumber: "42", chainId: 11155111 });
    expect(publicClient.getEnsAddress).toHaveBeenCalledWith(expect.objectContaining({ name: "family.eth", blockNumber: 42n }));
  });
  it.each(["", ".eth", "a..eth", "family.com", "0x123"])('rejects invalid name "%s"', (name) => {
    expect(() => normalizeRecipientName(name)).toThrow();
  });
  it.each([null, zeroAddress])("does not substitute a name owner for a missing payment record", async (address) => {
    vi.mocked(publicClient.getEnsAddress).mockResolvedValue(address);
    await expect(resolveRecipientName("family.eth")).resolves.toBeNull();
  });
  it("does not turn an RPC failure into a valid beneficiary", async () => {
    vi.mocked(publicClient.getEnsAddress).mockRejectedValue(new Error("unavailable"));
    await expect(resolveRecipientName("family.eth")).rejects.toThrow("unavailable");
  });
  it.each([[false, recipient, false], [true, zeroAddress, false], [true, recipient, true]] as const)(
    "shows labels only after a matching allocation has executed (%s, %s)", async (consumed, beneficiary, expected) => {
      vi.spyOn(publicClient, "readContract").mockImplementation(async (args) => args.functionName === "consumedRequests" ? consumed : [beneficiary]);
      await expect(confirmedRecipientLabel({ spaceAddress: recipient, beneficiary: recipient, allocationId: "1", requestId: `0x${"a".repeat(64)}` as Hex }, 100n)).resolves.toBe(expected);
    });
  it.each([[recipient, true], [`0x${"2".repeat(40)}` as Address, false]] as const)(
    "labels an agent budget only while its mandate names that agent (%s)", async (agent, expected) => {
      vi.spyOn(publicClient, "readContract").mockImplementation(async (args) =>
        args.functionName === "consumedRequests" ? true : args.functionName === "mandates" ? [agent] : [zeroAddress]);
      await expect(confirmedRecipientLabel({ spaceAddress: recipient, beneficiary: recipient, allocationId: "2", requestId: `0x${"b".repeat(64)}` as Hex }, 100n)).resolves.toBe(expected);
    });
});
