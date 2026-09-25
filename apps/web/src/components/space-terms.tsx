"use client";

import { ArrowRight, Bot, Inbox, Plus, UserRound } from "lucide-react";
import type { AccordClient } from "@accord/sdk";
import { useQuery } from "@tanstack/react-query";
import { formatUnits, zeroAddress } from "viem";
import { useSpaceTerms } from "@/lib/use-space-terms";
import { allocationAccess } from "@/lib/allocation-access";
import { AllocationTiming } from "./allocation-timing";
import { Button } from "./ui/button";

const periodLabels = ["No reset", "Daily", "Monthly", "Per window"] as const;
const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
export type AllocationAction = "allocate" | "mandate" | "settings" | "claim" | "payments";

export function SpaceTerms({ spaceAddress, decimals, account, client, symbol = "tokens", audience = "public", disabled = false, onAction }: {
  spaceAddress: string; decimals?: number; account: string; client?: AccordClient; symbol?: string;
  audience?: "owner" | "recipient" | "public"; disabled?: boolean;
  onAction?: (action: AllocationAction, id?: string) => void;
}) {
  const terms = useSpaceTerms(spaceAddress);
  const allocationIds = terms.data?.allocations.map(({ id }) => id.toString()) ?? [];
  const names = useQuery({
    queryKey: ["allocation-names", spaceAddress, allocationIds],
    enabled: !!client && allocationIds.length > 0,
    queryFn: () => client!.allocationNames(spaceAddress, allocationIds),
    staleTime: 60_000, retry: false,
  });
  const units = (value: bigint) => decimals === undefined
    ? `${value.toString()} base units` : `${formatUnits(value, decimals)} ${symbol}`;
  const allocations = terms.data?.allocations.filter((entry) => audience !== "recipient" ||
    allocationAccess(entry, account, terms.data!.blockTimestamp).yours) ?? [];
  const heading = audience === "owner" ? "Allocations you manage" : audience === "recipient" ? "Assigned to your wallet" : "Current allocations";

  return <section className="space-console__terms" aria-label={heading}>
    <div className="space-console__terms-heading"><div><h2 tabIndex={-1}>{heading}</h2><span>{audience === "owner" ? "Reserve funds for a person or give an agent permission to spend." : audience === "recipient" ? "Your access is determined by your connected wallet." : "Funds and permissions recorded on Sepolia."}</span></div><div className="space-console__terms-actions"><Button variant="ghost" size="sm" onClick={() => { void terms.refetch(); if (client && allocationIds.length) void names.refetch(); }} disabled={terms.isFetching}>{terms.isFetching ? "Refreshing…" : "Refresh"}</Button>{audience === "owner" && onAction ? <Button disabled={disabled} onClick={() => onAction("allocate")}><Plus size={16} />Create allocation</Button> : null}</div></div>
    {terms.isPending ? <p className="space-console__terms-status" role="status">Loading allocations…</p>
      : terms.isError ? <div className="allocation-empty" role="alert"><h3>Allocations couldn’t be loaded</h3><p>Check your connection, then refresh to try again.</p></div>
      : allocations.length === 0 ? <div className="allocation-empty"><Inbox size={30} strokeWidth={1.4} /><h3>{audience === "owner" ? "Give these funds a purpose" : audience === "recipient" ? "No allocations found for this wallet" : "No allocations yet"}</h3><p>{audience === "owner" ? "Create an allocation to choose a recipient, reserve tokens, and set their limits." : audience === "recipient" ? "Ask the Space owner to assign funds to your wallet. If you received a link, check that you connected the intended wallet." : "The owner hasn’t added funds for a person or agent yet."}</p>{audience === "owner" && onAction ? <Button disabled={disabled} onClick={() => onAction("allocate")}><Plus size={16} />Create first allocation</Button> : null}</div>
      : <div className="space-console__terms-list">{allocations.toReversed().map((entry) => {
        const { id, allocation, mandate, schedule } = entry;
        const access = allocationAccess(entry, account, terms.data!.blockTimestamp);
        const { isAgent, recipient, yours, closed, funded, mandateActive } = access;
        const name = names.data?.names.find((item) => item.allocationId === id.toString() && item.address.toLowerCase() === recipient.toLowerCase());
        const expired = schedule && schedule[1] <= terms.data!.blockTimestamp;
        const state = closed ? "Closed" : expired ? "Expired" : !funded ? "Fully used" : isAgent && !mandateActive ? "Needs mandate" : "Active";
        return <article className={`space-console__term${yours ? " is-yours" : ""}`} key={id.toString()}>
          <div className="allocation-identity"><span className={`allocation-icon${isAgent ? " is-agent" : ""}`}>{isAgent ? <Bot size={21} /> : <UserRound size={21} />}</span><div><h3>Allocation {id.toString()}</h3><p>{isAgent ? "Agent budget" : name?.name ?? "Personal allocation"}</p></div><span className={`allocation-status${closed || !funded || expired ? " is-muted" : ""}`}>{state}</span></div>
          <div className="allocation-funds"><span>Remaining</span><strong>{units(allocation[1])}</strong></div>
          <dl className="allocation-details"><div><dt>{isAgent ? "Agent" : "Recipient"}</dt><dd title={recipient}>{recipient === zeroAddress ? "Not assigned" : <>{shortAddress(recipient)}{yours ? <span className="allocation-you">You</span> : null}</>}</dd></div><div><dt>{allocation[5] === 0 ? "Spending limit" : `${periodLabels[allocation[5]]} limit`}</dt><dd>{units(allocation[2])}</dd></div>{isAgent && recipient !== zeroAddress ? <><div><dt>Daily agent limit</dt><dd>{units(mandate[4])}</dd></div><div><dt>Max per payment</dt><dd>{units(mandate[5])}</dd></div><div><dt>Mandate expires</dt><dd>{new Date(Number(mandate[8]) * 1000).toLocaleDateString()}</dd></div></> : null}</dl>
          {!isAgent ? <p className="allocation-condition">{closed ? "Unspent funds returned to the owner." : expired ? "Claim window ended. Unspent funds remain recoverable by the owner." : !funded ? "Allocation fully used." : `${name ? "ENS name saved at setup · " : ""}Wallet fixed · World ID required for claims.`}</p> : <p className="allocation-condition">{closed ? "Unspent funds returned to the owner." : mandateActive ? "Payments follow the mandate’s daily limit and screening checks." : "The owner must set an active mandate before this agent can pay."}</p>}
          {schedule ? <><p className="allocation-condition">Every {schedule[2]} seconds · {Number(schedule[1] - schedule[0]) / 60} minutes from funding</p><AllocationTiming allocation={allocation} schedule={schedule} blockTimestamp={terms.data!.blockTimestamp} observedAt={terms.data!.observedAt} decimals={decimals} symbol={symbol} /></> : null}
          {onAction && !closed ? <div className="allocation-actions">{audience === "owner" ? <>{isAgent && funded ? <Button variant="outline" disabled={disabled} onClick={() => onAction("mandate", id.toString())}>{mandateActive ? "Edit mandate" : "Set mandate"}<ArrowRight size={14} /></Button> : null}<Button variant="ghost" disabled={disabled} onClick={() => onAction("settings", id.toString())}>Manage access</Button></> : access.canClaim ? <Button disabled={disabled} onClick={() => onAction("claim", id.toString())}>Claim funds<ArrowRight size={15} /></Button> : access.canPay ? <Button disabled={disabled} onClick={() => onAction("payments", id.toString())}>Make payment<ArrowRight size={15} /></Button> : null}</div> : null}
        </article>;
      })}</div>}
    {terms.data && terms.data.count > BigInt(20) ? <p className="space-console__terms-status">Showing matches in the latest 20 allocations, out of {terms.data.count.toString()} total. Use an allocation ID below to access an older allocation.</p> : null}
    {audience === "recipient" ? <p className="allocation-footnote">The owner can close an allocation and recover its unspent funds. A shared link does not grant access.</p> : null}
  </section>;
}
