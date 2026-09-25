"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { sepolia } from "@reown/appkit/networks";
import { MotionConfig } from "motion/react";
import { useState } from "react";
import { Toaster } from "sonner";
import { createConfig, http, WagmiProvider } from "wagmi";
import { AccordProvider } from "@/lib/accord";

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
      description: "Allowances for humans and their AI agents",
      url: typeof window === "undefined" ? "http://localhost:3000" : window.location.origin,
      icons: [],
    },
    features: { analytics: false, swaps: false, onramp: false },
    enableWalletGuide: false,
    themeMode: "light",
    themeVariables: { "--w3m-accent": "#16122b", "--w3m-border-radius-master": "3px" },
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
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">
          <AccordProvider>{children}</AccordProvider>
        </MotionConfig>
        <Toaster position="bottom-center" toastOptions={{ className: "!rounded-2xl !font-sans !shadow-[0_24px_50px_-30px_rgb(22_18_43/0.6)]" }} />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
