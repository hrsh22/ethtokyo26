import { describe, expect, it, vi } from "vitest";
import { getAddress, zeroAddress } from "viem";
import { parseAgentWallet, resolveAgentWallet } from "./agent-wallet";

const wallet = getAddress("0xd288B7e8e8C968eE0F21f0bA5Fb726e9D88dbea9");
const otherWallet = "0x1111111111111111111111111111111111111111";
const record = { name: "harsh2.eth", address: wallet, chainId: 11155111 };

describe("agent wallet input", () => {
  it("accepts a trimmed raw address without asking ENS", async () => {
    const lookup = vi.fn();
    expect(await resolveAgentWallet(` ${wallet} `, lookup)).toBe(wallet);
    expect(lookup).not.toHaveBeenCalled();
  });
  it("normalizes ENS input and returns the actual signing address", async () => {
    const lookup = vi.fn().mockResolvedValue(record);
    expect(parseAgentWallet(" Harsh2.eth ")).toEqual({ name: "harsh2.eth" });
    expect(await resolveAgentWallet(" Harsh2.eth ", lookup)).toBe(wallet);
    expect(lookup).toHaveBeenCalledWith("harsh2.eth");
  });
  it("rejects malformed input and the zero wallet before lookup", async () => {
    const lookup = vi.fn();
    for (const input of ["", "0x123", zeroAddress, "research", "harsh..eth"]) {
      await expect(resolveAgentWallet(input, lookup)).rejects.toThrow("Enter a wallet address");
    }
    expect(lookup).not.toHaveBeenCalled();
  });
  it("rechecks the name and rejects a changed signer instead of silently following it", async () => {
    const lookup = vi.fn().mockResolvedValueOnce(record).mockResolvedValueOnce({ ...record, address: otherWallet });
    const confirmed = await resolveAgentWallet("harsh2.eth", lookup);
    await expect(resolveAgentWallet("harsh2.eth", lookup, confirmed)).rejects.toThrow("different wallet");
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it("rejects missing, zero-address, wrong-name and wrong-network results", async () => {
    await expect(resolveAgentWallet("harsh2.eth", vi.fn().mockRejectedValue({ _tag: "NotFound" }))).rejects.toThrow("no wallet on Sepolia");
    for (const result of [{ ...record, address: zeroAddress }, { ...record, address: "invalid" }, { ...record, name: "someone.eth" }, { ...record, chainId: 1 }]) {
      await expect(resolveAgentWallet("harsh2.eth", vi.fn().mockResolvedValue(result))).rejects.toThrow("invalid wallet");
    }
  });
  it("stops on lookup failure even when a wallet was previously confirmed", async () => {
    const lookup = vi.fn().mockRejectedValue(new Error("private RPC URL"));
    await expect(resolveAgentWallet("harsh2.eth", lookup, wallet)).rejects.toThrow("ENS lookup is unavailable");
  });
});
