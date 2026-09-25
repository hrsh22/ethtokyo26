"use client";

import { spaceAccountAbi } from "@accord/chain";
import { useQueryClient } from "@tanstack/react-query";
import { getAddress, type Hex } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { SEPOLIA_CHAIN_ID, useAccord } from "./accord";

/** Shared transaction plumbing for every wallet action in a Space. */
export function useChainActions(spaceAddress?: string) {
  const cache = useQueryClient();
  const connection = useAccount();
  const chain = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const { auth } = useAccord();

  function requireWallet() {
    if (!chain || connection.chainId !== SEPOLIA_CHAIN_ID) throw new Error("Switch your wallet to Ethereum Sepolia first.");
    if (!auth.signedIn) throw new Error("Sign in with your wallet first.");
    return chain;
  }

  async function refresh() {
    await Promise.all(["space-terms", "space-activity", "allocation-names", "allocation"].map((key) =>
      cache.invalidateQueries({ queryKey: [key, spaceAddress] })));
  }

  async function waitForSuccess(hash: Hex) {
    const receipt = await requireWallet().waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("The transaction reverted onchain. Nothing moved.");
    await refresh();
    return receipt;
  }

  /**
   * Some wallets never return the hash of a mined transaction. The permit's
   * request ID is consumed onchain either way, so watch for that too.
   */
  async function sendPermitTransaction(requestId: Hex, submit: () => Promise<Hex>): Promise<Hex | null> {
    const client = requireWallet();
    const space = getAddress(spaceAddress!);
    let finished = false;
    const onchain = (async () => {
      for (let attempt = 0; attempt < 90 && !finished; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (finished) break;
        try {
          if (await client.readContract({ address: space, abi: spaceAccountAbi, functionName: "consumedRequests", args: [requestId] })) {
            return { kind: "confirmed" as const };
          }
        } catch { /* A transient read failure should not discard the wallet request. */ }
      }
      throw new Error("Your wallet didn't respond in time. Check the activity feed before retrying; it may have gone through.");
    })();
    try {
      const result = await Promise.race([submit().then((hash) => ({ kind: "hash" as const, hash })), onchain]);
      if (result.kind === "hash") { await waitForSuccess(result.hash); return result.hash; }
      await refresh();
      return null;
    } finally { finished = true; }
  }

  return { chain, requireWallet, refresh, waitForSuccess, sendPermitTransaction };
}

export function permitFrom(intent: { permit: { actor: string; action: number; allocationId: string; recipient: string; amount: string;
  requestId: string; nonce: string; expiry: string; policyVersion: string; detailsHash: string } }) {
  return {
    actor: getAddress(intent.permit.actor),
    action: intent.permit.action,
    allocationId: BigInt(intent.permit.allocationId),
    recipient: getAddress(intent.permit.recipient),
    amount: BigInt(intent.permit.amount),
    requestId: intent.permit.requestId as Hex,
    nonce: BigInt(intent.permit.nonce),
    expiry: BigInt(intent.permit.expiry),
    policyVersion: BigInt(intent.permit.policyVersion),
    detailsHash: intent.permit.detailsHash as Hex,
  };
}

export const explorerTx = (hash: string) => process.env.NEXT_PUBLIC_ACCORD_LOCAL_E2E === "1" ? undefined : `https://sepolia.etherscan.io/tx/${hash}`;
export const explorerAddress = (address: string) => process.env.NEXT_PUBLIC_ACCORD_LOCAL_E2E === "1" ? undefined : `https://sepolia.etherscan.io/address/${address}`;
