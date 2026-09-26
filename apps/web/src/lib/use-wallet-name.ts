"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, type Address } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { usePublicClient } from "wagmi";

// Read mainnet names independently of the connected wallet's transaction network.
const mainnetEns = createPublicClient({
  chain: mainnet,
  transport: http("https://ethereum-rpc.publicnode.com", { timeout: 5_000, retryCount: 1 }),
});

export function useWalletName(address?: Address) {
  const sepoliaEns = usePublicClient({ chainId: sepolia.id });
  return useQuery({
    queryKey: ["wallet-primary-name", address?.toLowerCase()],
    enabled: !!address,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      if (!address) return null;
      // Universal Resolver verifies that the primary name resolves back to this wallet.
      try {
        const name = await mainnetEns.getEnsName({ address });
        if (name) return name;
      } catch { /* Keep the address usable if the lookup service is unavailable. */ }
      try { return await sepoliaEns?.getEnsName({ address }) ?? null; }
      catch { return null; }
    },
  });
}
