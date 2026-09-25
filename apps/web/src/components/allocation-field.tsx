"use client";

import { zeroAddress } from "viem";
import { useState } from "react";
import { useSpaceTerms } from "@/lib/use-space-terms";
import { allocationAccess } from "@/lib/allocation-access";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Purpose = "claim" | "payments" | "mandate" | "recover" | "revoke";
export function AllocationField({ spaceAddress, account, purpose, selectedId = "", onChange }: {
  spaceAddress: string; account: string; purpose: Purpose; selectedId?: string; onChange?: (id: string) => void;
}) {
  const terms = useSpaceTerms(spaceAddress);
  const [manual, setManual] = useState(false);
  const options = terms.data?.allocations.filter((entry) => {
    const access = allocationAccess(entry, account, terms.data!.blockTimestamp);
    if (access.closed) return false;
    if (purpose === "claim") return access.canClaim;
    if (purpose === "payments") return access.canPay;
    if (purpose === "mandate") return access.isAgent && access.funded;
    if (purpose === "revoke") return access.isAgent && entry.mandate[9];
    return true;
  }) ?? [];
  const selectedExists = options.some(({ id }) => id.toString() === selectedId);
  const useManual = manual || options.length === 0 || (!!selectedId && !selectedExists);
  return <div className="allocation-field"><Label className="space-console__field"><span>Allocation</span>{useManual ? <Input name="allocationId" inputMode="numeric" pattern="[1-9][0-9]*" required defaultValue={selectedId} placeholder="Enter allocation ID" onChange={(event) => { setManual(true); onChange?.(event.target.value); }} /> : <select name="allocationId" defaultValue={selectedExists ? selectedId : ""} required onChange={(event) => onChange?.(event.target.value)}><option value="" disabled>Select an allocation</option>{options.map(({ id, allocation }) => <option key={id.toString()} value={id.toString()}>Allocation {id.toString()} · {allocation[0] === zeroAddress ? "Agent budget" : `${allocation[0].slice(0, 6)}…${allocation[0].slice(-4)}`}</option>)}</select>}</Label>{options.length > 0 && !selectedId ? <button className="allocation-field__toggle" type="button" onClick={() => { setManual(!manual); onChange?.(""); }}>{manual ? "Choose from your allocations" : "Use an allocation ID instead"}</button> : null}</div>;
}
