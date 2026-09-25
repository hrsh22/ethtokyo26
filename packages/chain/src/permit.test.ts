import { describe, expect, it } from "vitest";
import { concatHex, encodeAbiParameters, keccak256, parseAbiParameters, recoverTypedDataAddress, stringToHex, zeroAddress, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { hashAllocationTerms, hashMandateTerms, hashSpacePermit, PermitAction, signSpacePermit, spacePermitTypedData } from "./permit";
import type { SpacePermit } from "./permit";

const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const space: Address = "0x1111111111111111111111111111111111111111";
const recipient: Address = "0x2222222222222222222222222222222222222222";
const permit: SpacePermit = {
  actor: signer.address, action: PermitAction.Pay, allocationId: 7n,
  recipient, amount: 5n * 10n ** 18n, requestId: `0x${"ab".repeat(32)}`,
  nonce: 42n, expiry: 1_900_000_000n, policyVersion: 3n, detailsHash: zeroHash,
};

// Independent translation of SpaceAccount._hashPermit and OpenZeppelin EIP712.
// Deliberately does not reuse permitTypes or the production domain helper.
function solidityDigest(value: SpacePermit, chainId = 11155111, verifyingContract: Address = space) {
  const domain = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,bytes32,bytes32,uint256,address"),
    [keccak256(stringToHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
      keccak256(stringToHex("AccordSpace")), keccak256(stringToHex("1")), BigInt(chainId), verifyingContract],
  ));
  const struct = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,address,uint8,uint256,address,uint256,bytes32,uint256,uint64,uint64,bytes32"),
    [keccak256(stringToHex("Permit(address actor,uint8 action,uint256 allocationId,address recipient,uint256 amount,bytes32 requestId,uint256 nonce,uint64 expiry,uint64 policyVersion,bytes32 detailsHash)")),
      value.actor, value.action, value.allocationId, value.recipient, value.amount,
      value.requestId, value.nonce, value.expiry, value.policyVersion, value.detailsHash],
  ));
  return keccak256(concatHex(["0x1901", domain, struct]));
}

describe("SpaceAccount permit encoding", () => {
  it.each(Object.values(PermitAction))("matches Solidity abi.encode for action %i", (action) => {
    const value = { ...permit, action };
    expect(hashSpacePermit(space, value)).toBe(solidityDigest(value));
  });

  it("matches Solidity at integer boundaries without losing precision", () => {
    const value = { ...permit, nonce: (1n << 256n) - 1n, amount: (1n << 256n) - 1n,
      expiry: (1n << 64n) - 1n, policyVersion: (1n << 64n) - 1n };
    expect(hashSpacePermit(space, value)).toBe(solidityDigest(value));
  });

  it("recovers the signer and binds every permit field and domain", async () => {
    const signature = await signSpacePermit(signer, space, permit);
    expect(await recoverTypedDataAddress({ ...spacePermitTypedData(space, permit), signature })).toBe(signer.address);
    const changed: Partial<SpacePermit>[] = [
      { actor: recipient }, { action: PermitAction.Claim }, { allocationId: 8n },
      { recipient: space }, { amount: permit.amount + 1n }, { requestId: `0x${"cd".repeat(32)}` },
      { nonce: 43n }, { expiry: permit.expiry + 1n }, { policyVersion: 4n },
      { detailsHash: `0x${"ef".repeat(32)}` },
    ];
    for (const change of changed) {
      expect(await recoverTypedDataAddress({ ...spacePermitTypedData(space, { ...permit, ...change }), signature })).not.toBe(signer.address);
    }
    expect(hashSpacePermit(recipient, permit)).not.toBe(hashSpacePermit(space, permit));
    expect(hashSpacePermit(space, permit, 1)).not.toBe(hashSpacePermit(space, permit));
  });

  it("matches Solidity allocation and mandate details encodings", () => {
    expect(hashAllocationTerms(200n, 2)).toBe(keccak256(encodeAbiParameters(parseAbiParameters("uint256,uint8"), [200n, 2])));
    const terms = { registry: recipient, nameId: 9n, expectedResource: 10n, dailyCap: 20n, maxPerPayment: 5n, expiry: 1_900_000_000n };
    expect(hashMandateTerms(terms)).toBe(keccak256(encodeAbiParameters(
      parseAbiParameters("address,uint256,uint256,uint256,uint256,uint64"),
      [terms.registry, terms.nameId, terms.expectedResource, terms.dailyCap, terms.maxPerPayment, terms.expiry],
    )));
  });

  it("allows zero recipient and amount for administrative actions", () => {
    const value = { ...permit, action: PermitAction.RevokeMandate, recipient: zeroAddress, amount: 0n };
    expect(hashSpacePermit(space, value)).toBe(solidityDigest(value));
  });

  it.each([
    { nonce: -1n }, { nonce: 1n << 256n }, { expiry: 1n << 64n },
    { policyVersion: -1n }, { requestId: zeroHash }, { requestId: "0x01" },
    { detailsHash: "0x01" }, { actor: zeroAddress }, { action: 7 },
  ])("rejects malformed or unexecutable permits: %#", (change) => {
    expect(() => hashSpacePermit(space, { ...permit, ...change } as SpacePermit)).toThrow();
  });

  it("rejects invalid domains and snapshots the message", () => {
    expect(() => hashSpacePermit(zeroAddress, permit)).toThrow();
    expect(() => hashSpacePermit(space, permit, 0)).toThrow();
    expect(() => hashSpacePermit(space, permit, Number.MAX_SAFE_INTEGER + 1)).toThrow();
    const copy = { ...permit };
    const data = spacePermitTypedData(space, copy);
    copy.amount = 0n;
    expect(data.message.amount).toBe(permit.amount);
  });
});
