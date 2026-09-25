import { encodeAbiParameters, hashTypedData, isAddress, keccak256, zeroAddress, zeroHash } from "viem";
import type { Address, Hex, LocalAccount } from "viem";
import { sepolia } from "viem/chains";

export const permitTypes = {
  Permit: [
    { name: "actor", type: "address" },
    { name: "action", type: "uint8" },
    { name: "allocationId", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "requestId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint64" },
    { name: "policyVersion", type: "uint64" },
    { name: "detailsHash", type: "bytes32" },
  ],
} as const;

export const PermitAction = {
  CreateAllocation: 0,
  SetMandate: 1,
  Claim: 2,
  Pay: 3,
  RevokeMandate: 4,
  RecoverAllocation: 5,
} as const;

export type SpacePermit = {
  actor: Address;
  action: (typeof PermitAction)[keyof typeof PermitAction];
  allocationId: bigint;
  recipient: Address;
  amount: bigint;
  requestId: Hex;
  nonce: bigint;
  expiry: bigint;
  policyVersion: bigint;
  detailsHash: Hex;
};

export function spacePermitDomain(space: Address, chainId: number = sepolia.id) {
  if (!isAddress(space) || space === zeroAddress) throw new Error("Invalid Space address");
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid chain ID");
  return { name: "AccordSpace", version: "1", chainId, verifyingContract: space } as const;
}

/** Exact Solidity Permit encoding. Authorization and live policy checks belong to the issuer. */
export function spacePermitTypedData(space: Address, permit: SpacePermit, chainId: number = sepolia.id) {
  if (!isAddress(permit.actor) || permit.actor === zeroAddress || !isAddress(permit.recipient)) {
    throw new Error("Invalid permit address");
  }
  if (!Number.isInteger(permit.action) || permit.action < 0 || permit.action > 5) {
    throw new Error("Invalid permit action");
  }
  for (const key of ["requestId", "detailsHash"] as const) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(permit[key])) throw new Error(`Invalid ${key}`);
  }
  if (permit.requestId === zeroHash) throw new Error("Request ID must be nonzero");
  for (const key of ["allocationId", "amount", "nonce", "expiry", "policyVersion"] as const) {
    const bits = key === "expiry" || key === "policyVersion" ? 64n : 256n;
    const value = permit[key];
    if (typeof value !== "bigint" || value < 0n || value >= 1n << bits) {
      throw new Error(`Invalid ${key}`);
    }
  }
  return {
    domain: spacePermitDomain(space, chainId),
    types: permitTypes,
    primaryType: "Permit" as const,
    message: { ...permit },
  };
}

export function hashSpacePermit(space: Address, permit: SpacePermit, chainId: number = sepolia.id) {
  return hashTypedData(spacePermitTypedData(space, permit, chainId));
}

/** Sign only after the caller has verified the Space's immutable authorizer and all action gates. */
export function signSpacePermit(signer: LocalAccount, space: Address, permit: SpacePermit, chainId: number = sepolia.id) {
  return signer.signTypedData(spacePermitTypedData(space, permit, chainId));
}

export function hashAllocationTerms(periodCap: bigint, period: 0 | 1 | 2) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint8" }],
      [periodCap, period],
    ),
  );
}

export type MandateTerms = {
  registry: Address;
  nameId: bigint;
  expectedResource: bigint;
  dailyCap: bigint;
  maxPerPayment: bigint;
  expiry: bigint;
};

export function hashMandateTerms(terms: MandateTerms) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint64" },
      ],
      [
        terms.registry,
        terms.nameId,
        terms.expectedResource,
        terms.dailyCap,
        terms.maxPerPayment,
        terms.expiry,
      ],
    ),
  );
}
