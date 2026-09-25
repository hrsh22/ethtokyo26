"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Tabs } from "radix-ui";
import { ArrowLeft, Bot, History, Settings2, ShieldCheck, UserRound, Wallet } from "lucide-react";
import type { AccordClient } from "@accord/sdk";
import { Button } from "./ui/button";
import { SpaceTerms, type AllocationAction } from "./space-terms";
import { SpaceActivity } from "./space-activity";

const actionCopy: Record<AllocationAction, { title: string; description: string }> = {
  allocate: { title: "Create an allocation", description: "Choose who gets access, how much to reserve, and how they can use it." },
  mandate: { title: "Give an agent permission to spend", description: "Attach a mandate to a funded agent allocation. You control the limits and expiry." },
  settings: { title: "Manage access", description: "Stop an agent’s spending permission or close an allocation and return its unspent funds." },
  claim: { title: "Claim your funds", description: "Verify your identity, choose an amount, and confirm the claim in your wallet." },
  payments: { title: "Pay from your agent budget", description: "Choose a recipient and amount. Your mandate and screening checks apply to every payment." },
};

export function SpaceWorkspace({ isOwner, account, spaceAddress, client, decimals, symbol, busy, action, onAction, children }: {
  isOwner: boolean; account: string; spaceAddress: string; client: AccordClient; decimals?: number; symbol: string;
  busy: boolean; action: AllocationAction | null; onAction: (action: AllocationAction | null, id?: string) => void; children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const previousAction = useRef(action);
  useEffect(() => {
    if (previousAction.current === action) return;
    previousAction.current = action;
    root.current?.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"] h2')?.focus({ preventScroll: true });
  }, [action]);
  const [view, setView] = useState(isOwner ? "manage" : "mine");
  const actingAsOwner = view === "manage";
  const actionInfo = action ? actionCopy[action] : null;
  return <Tabs.Root ref={root} className="space-workspace" value={view} onValueChange={(next) => { setView(next); onAction(null); }}>
    <Tabs.List className="space-perspectives" aria-label="Your role in this Space">
      {isOwner ? <Tabs.Trigger value="manage" disabled={busy}><ShieldCheck size={21} /><span><strong>Manage Space</strong><small>Create allocations & set permissions</small></span></Tabs.Trigger> : null}
      <Tabs.Trigger value="mine" disabled={busy}><Wallet size={21} /><span><strong>My allocations</strong><small>Claim funds & use your agent budgets</small></span></Tabs.Trigger>
      <Tabs.Trigger className="space-perspectives__activity" value="activity" disabled={busy}><History size={19} /><span><strong>Activity</strong><small>Transactions in this Space</small></span></Tabs.Trigger>
    </Tabs.List>
    {["manage", "mine"].filter((role) => role !== "manage" || isOwner).map((role) => <Tabs.Content value={role} key={role} className={`space-perspective space-perspective--${role}`}>
      <div className="space-role-note">{role === "manage" ? <ShieldCheck size={16} /> : <UserRound size={16} />}<span>{role === "manage" ? "You are the owner. You fund allocations and decide who can use them." : "You’re viewing access for your wallet. Only allocations assigned to you can be used."}</span></div>
      {actionInfo ? <>
        <div className="space-action-heading"><Button variant="ghost" disabled={busy} onClick={() => onAction(null)}><ArrowLeft size={15} />{actingAsOwner ? "All allocations" : "My allocations"}</Button><h2 tabIndex={-1}>{actionInfo.title}</h2><p>{actionInfo.description}</p></div>
        {children}
      </> : <>
        <SpaceTerms spaceAddress={spaceAddress} account={account} decimals={decimals} symbol={symbol} audience={role === "manage" ? "owner" : "recipient"} disabled={busy} onAction={onAction} />
        {role === "manage" ? <div className="space-owner-tools"><div><h3>Owner tools</h3><p>Permissions and recovery stay in your control.</p></div><Button variant="outline" disabled={busy} onClick={() => onAction("mandate")}><Bot size={16} />Agent mandates</Button><Button variant="ghost" disabled={busy} onClick={() => onAction("settings")}><Settings2 size={16} />Manage access</Button></div> : null}
        {role === "mine" ? <details className="space-known-allocation"><summary>Have an allocation ID?</summary><p>Use an older allocation, or retry if it hasn’t appeared yet. Your wallet must still have permission.</p><div><Button variant="outline" disabled={busy} onClick={() => onAction("claim")}>Claim by allocation ID</Button><Button variant="outline" disabled={busy} onClick={() => onAction("payments")}>Pay by allocation ID</Button></div></details> : null}
      </>}
    </Tabs.Content>)}
    <Tabs.Content value="activity"><div className="space-action-heading"><h2>Space activity</h2><p>Claims, payments, and permission changes across this Space.</p></div><SpaceActivity client={client} spaceAddress={spaceAddress} decimals={decimals} symbol={symbol} /></Tabs.Content>
  </Tabs.Root>;
}
