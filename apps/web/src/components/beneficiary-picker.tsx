"use client";

import type { AccordClient } from "@accord/sdk";
import { useId, useRef, useState } from "react";
import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export type BeneficiarySelection = { address: Address; ensName?: string };

export function BeneficiaryPicker({ client, disabled, onChange }: {
  client: AccordClient; disabled: boolean; onChange: (value: BeneficiarySelection | null) => void;
}) {
  const id = useId();
  const [input, setInput] = useState("");
  const [resolved, setResolved] = useState<BeneficiarySelection | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  function edit(next: string) {
    request.current++;
    setInput(next); setResolved(null); setConfirmed(false); setError(null); setLoading(false);
    onChange(null);
  }

  async function resolve() {
    const version = ++request.current;
    const value = input.trim();
    setLoading(true); setError(null); setResolved(null); setConfirmed(false); onChange(null);
    try {
      let recipient: BeneficiarySelection;
      if (value.startsWith("0x")) {
        if (!isAddress(value) || value.toLowerCase() === zeroAddress) throw new Error("Enter a valid, nonzero Ethereum wallet address.");
        recipient = { address: getAddress(value) };
      } else {
        const result = await client.resolveEnsRecipient(value);
        recipient = { address: getAddress(result.address), ensName: result.name };
      }
      if (version === request.current) setResolved(recipient);
    } catch (cause) {
      if (version !== request.current) return;
      const tag = cause && typeof cause === "object" && "_tag" in cause ? cause._tag : undefined;
      setError(tag === "NotFound" ? "This name has no payment address on Sepolia. Try another name or enter a wallet address."
        : tag === "BadRequest" ? "Enter a valid .eth name on Sepolia or an Ethereum wallet address."
        : cause instanceof Error && !tag ? cause.message
        : "ENS could not be reached. Try again, or enter the beneficiary’s wallet address.");
    } finally { if (version === request.current) setLoading(false); }
  }

  return <div className="beneficiary-picker">
    <Label htmlFor={id}>Beneficiary</Label>
    <div className="beneficiary-picker__entry">
      <Input id={id} value={input} placeholder="name.eth or 0x…" autoComplete="off" spellCheck={false}
        disabled={disabled} onChange={(event) => edit(event.target.value)} aria-describedby={`${id}-hint`}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (input.trim() && !loading) void resolve(); } }} />
      <Button type="button" variant="outline" disabled={disabled || loading || !input.trim()} onClick={() => void resolve()}>
        {loading ? "Resolving…" : input.trim().startsWith("0x") ? "Review wallet" : "Resolve name"}
      </Button>
    </div>
    <p id={`${id}-hint`} className="space-console__hint">ENS names resolve on Sepolia. The confirmed wallet stays fixed, even if the name changes.</p>
    {error && <p className="beneficiary-picker__error" role="alert">{error}</p>}
    {resolved && <div className="beneficiary-picker__result" aria-live="polite">
      <strong>{resolved.ensName ?? "Beneficiary wallet"}</strong>
      <span>{resolved.ensName ? "ENS resolved · Sepolia" : "Ethereum wallet · Sepolia"}</span>
      <code>{resolved.address}</code>
      <label className="beneficiary-picker__confirm"><input type="checkbox" checked={confirmed} disabled={disabled}
        onChange={(event) => { setConfirmed(event.target.checked); onChange(event.target.checked ? resolved : null); }} />
        <span>I confirm this wallet belongs to the intended beneficiary.</span>
      </label>
    </div>}
    <p className="space-console__hint">World ID is required for this person to claim. An ENS name alone does not verify a human.</p>
  </div>;
}
