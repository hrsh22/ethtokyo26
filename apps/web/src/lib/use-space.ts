"use client";

import { spaceAccountAbi } from "@accord/chain";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi, getAddress } from "viem";
import { usePublicClient } from "wagmi";
import { SEPOLIA_CHAIN_ID, useAccord } from "./accord";
import { allocationLabel, amount, shortAddress } from "./format";
import { useSpaceTerms, type SpaceAllocation } from "./use-space-terms";

/** Token, owner and token metadata, read straight from the Space contract. */
export function useSpaceMeta(address: string) {
  const { config } = useAccord();
  const chain = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  return useQuery({
    queryKey: ["space-meta", address],
    enabled: !!chain && (!!config.data || config.isError),
    retry: 1,
    staleTime: Infinity,
    queryFn: async () => {
      const space = getAddress(address);
      const [token, owner] = await Promise.all([
        chain!.readContract({ address: space, abi: spaceAccountAbi, functionName: "token" }),
        chain!.readContract({ address: space, abi: spaceAccountAbi, functionName: "owner" }),
      ]);
      if (!config.data?.demoTokenAddress || token.toLowerCase() !== config.data.demoTokenAddress.toLowerCase()) {
        throw new Error("Only tUSDC Spaces are supported by this app.");
      }
      const [decimals, symbol] = await Promise.all([
        chain!.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
        chain!.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => "tokens"),
      ]);
      return { token, owner, decimals, symbol: symbol.trim() || "tokens" };
    },
  });
}

/** Everything a Space screen needs: onchain terms for anyone, plus the API record once signed in. */
export function useSpace(address: string) {
  const { client, auth, account } = useAccord();
  const meta = useSpaceMeta(address);
  const draft = useQuery({
    queryKey: ["space-draft", address, account?.toLowerCase()],
    enabled: !!client && auth.signedIn,
    retry: false,
    queryFn: () => client!.lookupSpace(getAddress(address)),
  });
  // Public: the name the owner gave an activated Space, readable before sign-in.
  const profile = useQuery({
    queryKey: ["space-profile", address],
    enabled: !!client,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: () => client!.spaceProfile(getAddress(address)),
  });
  const terms = useSpaceTerms(address);
  const ids = terms.data?.allocations.map(({ id }) => id.toString()) ?? [];
  const names = useQuery({
    queryKey: ["allocation-names", address, ids],
    enabled: !!client && ids.length > 0,
    staleTime: 60_000,
    retry: false,
    queryFn: () => client!.allocationNames(address, ids),
  });
  const isOwner = !!account && !!meta.data && meta.data.owner.toLowerCase() === account.toLowerCase();
  const decimals = meta.data?.decimals;
  const symbol = meta.data?.symbol ?? "tokens";
  return {
    meta, draft, terms, names, isOwner, decimals, symbol,
    units: (value: bigint) => amount(value, decimals, symbol),
    label: (entry: SpaceAllocation) => allocationLabel(entry, names.data?.names),
    title: draft.data?.name ?? profile.data?.name ?? `Space ${shortAddress(address)}`,
    titleKnown: !!(draft.data?.name ?? profile.data?.name) || profile.isError,
  };
}
