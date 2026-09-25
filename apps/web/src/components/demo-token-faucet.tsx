"use client";

import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { erc20Abi, getAddress, parseAbi } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { SEPOLIA_CHAIN_ID, useAccord } from "@/lib/accord";
import { describeError } from "@/lib/errors";
import { amount } from "@/lib/format";
import { Button } from "./ui/button";

const faucetAbi = parseAbi(["function faucet()"]);

/** The deployed demo token mints 1,000 ACD to the caller on every faucet transaction. */
export function DemoTokenFaucet({ inline = false }: { inline?: boolean }) {
  const { account, auth, config, wrongNetwork, switchNetwork, switching } = useAccord();
  const chain = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const [pending, setPending] = useState<"wallet" | "confirming" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const token = config.data?.demoTokenAddress;
  const balance = useQuery({
    queryKey: ["demo-token-balance", token, account?.toLowerCase()],
    enabled: !!token && !!account && !!chain && auth.signedIn,
    retry: false,
    refetchInterval: 30_000,
    queryFn: () => chain!.readContract({ address: getAddress(token!), abi: erc20Abi,
      functionName: "balanceOf", args: [getAddress(account!)] }),
  });

  async function claim() {
    if (!token || !chain || !account || !auth.signedIn || pending) return;
    setError(null);
    setPending("wallet");
    try {
      const hash = await writeContractAsync({ address: getAddress(token), abi: faucetAbi,
        functionName: "faucet", chainId: SEPOLIA_CHAIN_ID });
      setPending("confirming");
      const receipt = await chain.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error("The faucet transaction reverted on Sepolia.");
      await balance.refetch();
      toast.success("1,000 ACD added to your wallet");
    } catch (cause) {
      setError(describeError(cause, "Couldn’t get ACD. Check your wallet and try again."));
    } finally { setPending(null); }
  }

  if (!token || !auth.signedIn) return null;
  const Heading = inline ? "h3" : "h2";
  return <section id="demo-token-faucet" className={inline ? "rounded-3xl bg-lime-soft p-5" : "card p-6"} aria-labelledby="faucet-title">
    <div className="flex flex-wrap items-start gap-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-lime text-[#243300]"><Coins size={20} /></span>
      <div className="min-w-[180px] flex-1">
        <Heading id="faucet-title" className="font-display text-2xl font-extrabold">Get test ACD</Heading>
        <p className="mt-1 text-sm text-muted">Claim 1,000 ACD to fund allowances and budgets. Claim again whenever you need more.</p>
        {balance.data !== undefined ? <p className="mt-2 text-sm font-semibold">Your balance: {amount(balance.data, 18, "ACD")}</p> : null}
      </div>
    </div>
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <Button variant={inline ? "light" : "primary"} loading={!!pending || switching} onClick={() => void (wrongNetwork ? switchNetwork() : claim())}>
        {wrongNetwork ? "Switch to Sepolia" : pending === "wallet" ? "Confirm in your wallet" : pending === "confirming" ? "Confirming on Sepolia" : "Get 1,000 ACD"}
      </Button>
      <span className="text-xs text-muted">Sepolia ETH pays the network fee.</span>
    </div>
    {error ? <p role="alert" className="mt-3 text-sm font-medium text-bad">{error}</p> : null}
  </section>;
}
