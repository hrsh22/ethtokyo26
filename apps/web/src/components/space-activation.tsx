"use client";

import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { erc20Abi, getAddress, isAddress, zeroAddress, type Address } from "viem";
import { usePublicClient } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SpaceActivationProps = {
  demoTokenAddress?: string;
  disabled: boolean;
  activating: boolean;
  onActivate: (token: Address) => Promise<void>;
};

export function SpaceActivation({ demoTokenAddress, disabled, activating, onActivate }: SpaceActivationProps) {
  const id = useId();
  const publicClient = usePublicClient({ chainId: 11_155_111 });
  const [choice, setChoice] = useState<"demo" | "custom">("demo");
  const [customAddress, setCustomAddress] = useState("");
  const input = (choice === "demo" ? demoTokenAddress ?? "" : customAddress).trim();
  const address = isAddress(input) && input !== zeroAddress ? getAddress(input) : undefined;
  const asset = useQuery({
    queryKey: ["activation-asset", 11_155_111, address],
    queryFn: async () => {
      const [decimals, symbol] = await Promise.all([
        publicClient!.readContract({ address: address!, abi: erc20Abi, functionName: "decimals" }),
        publicClient!.readContract({ address: address!, abi: erc20Abi, functionName: "symbol" }).catch(() => "Token"),
        publicClient!.readContract({ address: address!, abi: erc20Abi, functionName: "balanceOf", args: [zeroAddress] }),
      ]);
      return { decimals, symbol: symbol.trim() || "Token" };
    },
    enabled: !!address && !!publicClient && !disabled,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const ready = !!address && asset.isSuccess && !asset.isFetching;
  const invalid = choice === "custom" && input.length > 0 && !address;
  const status = invalid ? "Enter a valid, non-zero token contract address."
    : choice === "custom" && !input ? "Enter the token’s contract address on Sepolia."
    : address && asset.isError ? "Couldn’t read this token on Sepolia. Check the address or retry."
    : address && asset.isFetching ? "Checking asset on Sepolia…"
    : choice === "custom" && ready ? `Selected: ${asset.data.symbol} · ${address!.slice(0, 6)}…${address!.slice(-4)}`
    : null;

  return <form className="space-activation" onSubmit={(event) => {
    event.preventDefault();
    if (!disabled && !activating && ready) void onActivate(address);
  }}>
    <fieldset disabled={disabled || activating}>
      <legend>Choose asset</legend>
      {demoTokenAddress ? <label className="space-activation__option">
        <input type="radio" name={`${id}-asset`} value="demo" checked={choice === "demo"} onChange={() => setChoice("demo")} />
        <span><strong>ACD · Demo token</strong><small>Test tokens for trying allocations. No monetary value.</small></span>
        <span className="space-activation__network">Sepolia</span>
      </label> : <p className="space-activation__help">No demo asset is configured. Choose a custom token under Advanced.</p>}

      <details className="space-activation__advanced">
        <summary>Advanced</summary>
        <label className="space-activation__option space-activation__option--custom">
          <input type="radio" name={`${id}-asset`} value="custom" checked={choice === "custom"} onChange={() => setChoice("custom")} />
          <span><strong>Use a custom token</strong><small>Choose another ERC-20 asset on Sepolia.</small></span>
        </label>
        <div className="space-activation__custom">
          <Label htmlFor={`${id}-address`}>Token contract address</Label>
          <Input id={`${id}-address`} value={customAddress} onChange={(event) => setCustomAddress(event.target.value)}
            disabled={choice !== "custom"} placeholder="0x…" autoComplete="off" spellCheck={false}
            aria-invalid={invalid || (choice === "custom" && asset.isError)} aria-describedby={`${id}-status`} />
        </div>
      </details>
    </fieldset>

    <div id={`${id}-status`} role="status" className={`space-activation__status${invalid || asset.isError ? " is-error" : ""}`}>
      {status}
      {address && asset.isError ? <Button type="button" variant="outline" size="sm" disabled={disabled || activating}
        onClick={() => void asset.refetch()}>Retry asset check</Button> : null}
    </div>
    <p className="space-activation__help">This asset is fixed after activation. You’ll add funds and allocations next.</p>
    <div className="space-activation__footer">
      <Button type="submit" disabled={disabled || activating || !ready}>{activating ? "Activating…" : "Activate Space"}</Button>
      <span>Network fee paid in Sepolia ETH.</span>
    </div>
  </form>;
}
