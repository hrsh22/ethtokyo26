"use client";

// Browser-only fixture: mounted by the preview helper, never exposed by production routes.
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, custom, WagmiProvider } from "wagmi";
import { sepolia } from "wagmi/chains";
import { decodeFunctionData, encodeFunctionResult, erc20Abi, type Abi, type Hex } from "viem";
import { spaceAccountAbi, ensPermissionAdapterAbi } from "@accord/chain";
import type { AccordClient } from "@accord/sdk";
import { SpaceConsole } from "../src/components/space-console";
import { owner, recipient, agent, space, token, timestamp, allocations } from "./space-fixtures";

const abi: Abi = [...spaceAccountAbi, ...ensPermissionAdapterAbi, ...erc20Abi];
let empty = false;
const config = createConfig({ ssr: true, batch: { multicall: false }, chains: [sepolia], transports: { [sepolia.id]: custom({
  async request({ method, params }) {
    if (method === "eth_chainId") return "0xaa36a7";
    if (method === "eth_blockNumber") return "0x1";
    if (method === "eth_getBlockByNumber") return { number: "0x1", timestamp: `0x${timestamp.toString(16)}`, transactions: [] };
    if (method === "eth_call") {
      const [{ data }] = params as [{ data: Hex }];
      const call = decodeFunctionData({ abi, data });
      const entry = allocations.find(({ id }) => id === call.args?.[0]);
      const results: Record<string, unknown> = { decimals: 6, symbol: "USDC", nextAllocationId: BigInt(empty ? 1 : 4), ensAdapter: token,
        allocations: entry?.allocation, mandates: entry?.mandate, isAuthorized: true };
      return encodeFunctionResult({ abi, functionName: call.functionName, result: results[call.functionName] });
    }
    throw new Error(`Preview does not support ${method}. No transactions are sent.`);
  },
}) } });
const client = {
  config: async () => ({ configured: true, factoryAddress: token, adapterAddress: token, authorizerAddress: token, demoTokenAddress: token }),
  worldStatus: async () => ({ configured: true, enrolled: false }),
  spaceActivity: async () => ({ events: [], fromBlock: "1", toBlock: "1" }),
} as unknown as AccordClient;
const draft = { id: "preview-space", name: "Tokyo collective", owner, templateId: "recurring-support" as const,
  createdAt: "2026-09-25", activatedAt: "2026-09-25", spaceAddress: space, tokenAddress: token };

export default function SpaceUxFixture() {
  const [role, setRole] = useState<"owner" | "recipient" | "agent" | "visitor" | "empty" | "draft">("owner");
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const accounts = { owner, recipient, agent, visitor: token, empty: owner, draft: owner };
  return <WagmiProvider config={config}><QueryClientProvider client={queryClient}>
    <div className="app-shell"><header className="site-header"><a className="brand" href="#">accord<span className="brand-dot">.</span></a><span style={{ fontSize: 13 }}>Space experience preview</span><label style={{ marginLeft: "auto", fontSize: 13 }}>View as <select aria-label="Preview role" value={role} onChange={(event) => {
      const next = event.target.value as typeof role;
      empty = next === "empty";
      queryClient.setQueryData(["space-terms", space], { count: BigInt(next === "empty" ? 0 : 3), allocations: next === "empty" ? [] : allocations, blockTimestamp: timestamp });
      setRole(next);
    }}>{Object.keys(accounts).map((name) => <option key={name}>{name}</option>)}</select></label></header>
    <main className="space-detail page-container"><a className="back-link" href="#">All Spaces</a><SpaceConsole key={role} account={accounts[role]} draft={role === "draft" ? { ...draft, spaceAddress: undefined, activatedAt: undefined } : draft} client={client} /></main>
    <footer className="site-footer page-container">Local UI fixtures. No wallet is connected and no transactions are sent.</footer></div>
  </QueryClientProvider></WagmiProvider>;
}
