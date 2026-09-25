"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { sepolia } from "@reown/appkit/networks";
import { useState } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim();
const rpc = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const localE2e = process.env.NEXT_PUBLIC_ACCORD_LOCAL_E2E === "1";
const networks = [sepolia] as [typeof sepolia];
const customRpcUrls = { "eip155:11155111": [{ url: rpc }] };

const adapter = projectId ? new WagmiAdapter({
  projectId,
  networks,
  ssr: true,
  ...(localE2e ? { batch: { multicall: false } } : {}),
  customRpcUrls,
  transports: { [sepolia.id]: http(rpc) },
}) : null;

if (adapter && projectId) {
  createAppKit({
    adapters: [adapter],
    projectId,
    networks,
    defaultNetwork: sepolia,
    customRpcUrls,
    metadata: {
      name: "Accord",
      description: "Permissioned spaces for people and agents",
      url: typeof window === "undefined" ? "http://localhost:3000" : window.location.origin,
      icons: [],
    },
    features: { analytics: false, swaps: false, onramp: false },
    enableWalletGuide: false,
    themeMode: "light",
    themeVariables: { "--w3m-accent": "#173d2f" },
  });
}

const config = adapter?.wagmiConfig ?? createConfig({
  chains: [sepolia],
  ssr: true,
  transports: { [sepolia.id]: http(rpc) },
});

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
