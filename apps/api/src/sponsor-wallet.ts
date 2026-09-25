import { SponsorUnavailable } from "@accord/api-contract";
import { createWalletClient, http, type Address, type Hex } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { publicClient } from "./chain";

export function sponsor() {
  const key = process.env.SPONSOR_PRIVATE_KEY;
  if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("Sponsor wallet is not configured");
  const account = privateKeyToAccount(key as Hex, { nonceManager });
  return createWalletClient({ account, chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com") });
}

/** Return the same fee caps used for the balance check and transaction submission. */
export async function fundedFees(address: Address, gas: bigint) {
  const [balance, fees] = await Promise.all([
    publicClient.getBalance({ address, blockTag: "pending" }), publicClient.estimateFeesPerGas(),
  ]);
  const reserve = BigInt(process.env.SPONSOR_MIN_BALANCE_WEI ?? "1000000000000000");
  const required = reserve + gas * fees.maxFeePerGas;
  if (balance < required) {
    console.warn(JSON.stringify({ event: "sponsor_low_balance", address, balanceWei: String(balance), requiredWei: String(required) }));
    throw new SponsorUnavailable({ reason: "insufficient_balance",
      message: "The gas sponsor needs a top-up. Nothing was submitted. Please try again shortly." });
  }
  return fees;
}

export function sponsorFailure(error: unknown, operation: "faucet" | "relay") {
  // RPC errors can contain credentials, signed requests and full transport URLs. Never log them verbatim.
  console.warn(JSON.stringify({ event: "sponsor_failed", operation,
    reason: error instanceof SponsorUnavailable ? error.reason : "service_unavailable" }));
  return error instanceof SponsorUnavailable ? error : new SponsorUnavailable({ reason: "service_unavailable",
    message: "The transaction service is temporarily unavailable. Please try again shortly." });
}
