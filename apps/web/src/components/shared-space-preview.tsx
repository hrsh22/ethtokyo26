"use client";
import "./space-console.css";
import type { AccordClient } from "@accord/sdk";
import { spaceAccountAbi } from "@accord/chain";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi, getAddress, zeroAddress } from "viem";
import { usePublicClient } from "wagmi";
import { SpaceTerms } from "./space-terms";
import { SpaceActivity } from "./space-activity";
import { ShareSpace } from "./share-space";

export function SharedSpacePreview({ address, account, client, compact = false }: { address: string; account?: string; client?: AccordClient; compact?: boolean }) {
  const chain = usePublicClient({ chainId: 11155111 });
  const meta = useQuery({ queryKey: ["shared-space", address], enabled: !!chain, retry: 1,
    queryFn: async () => {
      const space = getAddress(address);
      const [token, owner] = await Promise.all([
        chain!.readContract({ address: space, abi: spaceAccountAbi, functionName: "token" }),
        chain!.readContract({ address: space, abi: spaceAccountAbi, functionName: "owner" }),
      ]);
      const [decimals, symbol] = await Promise.all([
        chain!.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
        chain!.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
      ]);
      return { owner, token, decimals, symbol };
    } });
  return <section className="shared-space page-container" aria-labelledby="shared-heading"><h1 id="shared-heading">A Space shared with you.</h1><p>Review the allocation and its rules, then connect the permitted wallet to act. The link itself grants no access.</p><p className="address-text">{address}</p><ShareSpace address={address} showOpenLink={false} />
    {meta.isPending ? <p role="status">Reading the shared Space…</p> : meta.isError ? <p role="status">This Space could not be read on Sepolia. Check the link and try again.</p> : <><p>Asset: {meta.data.symbol} · Owner {meta.data.owner.slice(0, 6)}…{meta.data.owner.slice(-4)}{account?.toLowerCase() === meta.data.owner.toLowerCase() ? " · Your Space" : ""}</p>{!compact ? <div className="space-console"><SpaceTerms client={client} spaceAddress={address} decimals={meta.data.decimals} symbol={meta.data.symbol} account={account ?? zeroAddress} />{client ? <SpaceActivity client={client} spaceAddress={address} decimals={meta.data.decimals} symbol={meta.data.symbol} /> : null}</div> : null}</>}
  </section>;
}
