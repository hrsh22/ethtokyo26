"use client";

import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { erc20Abi, getAddress, type Hex } from "viem";
import { usePublicClient } from "wagmi";
import { SEPOLIA_CHAIN_ID, useAccord } from "@/lib/accord";
import { describeError } from "@/lib/errors";
import { amount } from "@/lib/format";
import { Button } from "./ui/button";

/** The sponsor sends 1,000 valueless tUSDC to the signed-in wallet per request. */
export function DemoTokenFaucet({ inline = false }: { inline?: boolean }) {
  const { account, auth, client, config } = useAccord();
  const chain = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const [pending, setPending] = useState(false);
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
    if (!token || !chain || !client || !account || !auth.signedIn || pending) return;
    setError(null);
    setPending(true);
    try {
      const { transactionHash: hash } = await client.claimTestUSDC();
      const receipt = await chain.waitForTransactionReceipt({ hash: hash as Hex, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error("The faucet transaction reverted on Sepolia.");
      await balance.refetch();
      toast.success("1,000 tUSDC added to your wallet");
    } catch (cause) {
      setError(describeError(cause, "Couldn’t get tUSDC. Try again shortly."));
    } finally { setPending(false); }
  }

  if (!token || !auth.signedIn) return null;
  const Heading = inline ? "h3" : "h2";
  return <section id="demo-token-faucet" className={inline ? "rounded-3xl bg-lime-soft p-5" : "card p-6"} aria-labelledby="faucet-title">
    <div className="flex flex-wrap items-start gap-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-lime text-[#243300]"><Coins size={20} /></span>
      <div className="min-w-[180px] flex-1">
        <Heading id="faucet-title" className="font-display text-2xl font-extrabold">Get test tUSDC</Heading>
        <p className="mt-1 text-sm text-muted">Claim 1,000 tUSDC to fund allowances and budgets. Claim again whenever you need more.</p>
        {balance.data !== undefined ? <p className="mt-2 text-sm font-semibold">Your balance: {amount(balance.data, 6, "tUSDC")}</p> : null}
      </div>
    </div>
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <Button variant={inline ? "light" : "primary"} loading={pending} onClick={() => void claim()}>
        {pending ? "Confirming on Sepolia" : "Get 1,000 tUSDC"}
      </Button>
      <span className="text-xs text-muted">Accord pays the network fee.</span>
    </div>
    {error ? <p role="alert" className="mt-3 text-sm font-medium text-bad">{error}</p> : null}
  </section>;
}
