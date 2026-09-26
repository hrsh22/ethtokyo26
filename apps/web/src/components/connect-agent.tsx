"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, AtSign, Check, Plug, Plus } from "lucide-react";
import { useState } from "react";
import { useAccord } from "@/lib/accord";
import { describeError } from "@/lib/errors";
import { shortAddress } from "@/lib/format";
import { Commands } from "./agent-tools";
import { Button } from "./ui/button";
import { SignInCard } from "./sign-in-card";

export function ConnectAgent({ id }: { id: string }) {
  const { client, auth, account, checkSession } = useAccord();
  const [draftId, setDraftId] = useState(""), [allocationId, setAllocationId] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const secret = useQuery({ queryKey: ["pairing-secret", id], enabled: auth.signedIn, staleTime: Infinity, retry: false, queryFn: () => {
    const fragment = window.location.hash.slice(1), key = `accord:pairing:${id}`;
    if (/^[a-f0-9]{64}$/.test(fragment)) { sessionStorage.setItem(key, fragment); window.history.replaceState(null, "", window.location.pathname); return fragment; }
    return sessionStorage.getItem(key) ?? "";
  } });
  const pairing = useQuery({ queryKey: ["pairing", id, account], enabled: !!client && auth.signedIn && !!secret.data,
    queryFn: () => client!.reviewAgentPairing(id, secret.data!), retry: false });
  const spaces = useQuery({ queryKey: ["pairing-spaces", account], enabled: !!client && auth.signedIn,
    queryFn: () => client!.listSpaces() });
  const activeSpaces = spaces.data?.spaces.filter(s => s.spaceAddress && s.activatedAt) ?? [];
  const selected = activeSpaces.find(s => s.id === draftId) ?? activeSpaces[0];
  const identities = useQuery({ queryKey: ["pairing-identities", selected?.id], enabled: !!client && !!selected,
    queryFn: () => client!.agentIdentities(selected!.id), refetchInterval: 10_000 });
  const matches = identities.data?.identities.filter(i => i.active && i.confirmed && i.agent.toLowerCase() === pairing.data?.agent.toLowerCase() && (!pairing.data?.name || i.name === pairing.data.name)) ?? [];
  const identity = matches.find(i => i.allocationId === allocationId) ?? matches[0];
  async function accept() {
    if (!client || !selected || !identity || !secret.data || busy) return;
    setBusy(true); setMessage("");
    try { await client.acceptAgentPairing({ id, reviewToken: secret.data, draftId: selected.id, allocationId: identity.allocationId }); await pairing.refetch(); }
    catch (error) { checkSession(error); setMessage(describeError(error, "The agent could not be connected.")); }
    finally { setBusy(false); }
  }
  if (!auth.signedIn) return <SignInCard title="Connect your agent" body="Sign in as the Space owner to review this connection."/>;
  const pair = pairing.data;
  return <div className="mx-auto max-w-[720px]">
    <Link href="/spaces" className="mb-6 inline-flex items-center gap-2 font-semibold text-muted"><ArrowLeft size={18}/>Your Spaces</Link>
    <section className="card overflow-hidden"><div className="bg-lilac-soft p-7 sm:p-9"><span className="grid size-12 place-items-center rounded-2xl bg-white text-[#6544ba]"><Plug size={24}/></span>
      <h1 className="mt-5 font-display text-4xl font-extrabold">{pair?.connectionId ? "Your agent is connected" : "Connect your agent"}</h1>
      <p className="mt-3 text-ink-soft">{pair?.connectionId ? "Return to your terminal to finish setting up the assistant." : "Choose the Space and budget this agent can use."}</p></div>
      <div className="grid gap-5 p-7 sm:p-9">
        {pair?.connectionId ? <><div className="flex items-start gap-3 rounded-2xl bg-good-soft p-4 text-good"><Check className="mt-0.5 shrink-0"/><p className="break-all font-semibold">{pair.name}</p></div>
          <div><p className="font-semibold">Next, in your terminal</p><p className="mt-1 text-sm text-muted">Generate the MCP entry and add it to your assistant’s settings. Its tools can then read this budget and request purchases.</p>
            <div className="mt-3"><Commands text="npx accord mcp config"/></div></div>
          <div className="flex flex-wrap gap-2">{selected && identity ? <Button asChild><Link href={`/spaces/${selected.spaceAddress}/a/${identity.allocationId}`}>Open the agent</Link></Button> : null}
            <Button asChild variant="soft"><Link href="/developers">MCP tools and SDK</Link></Button></div></>
          : !secret.data && !secret.isPending ? <p role="alert" className="text-bad">Open the full connection link from your terminal. Its private review code is missing.</p>
          : pairing.isError ? <p role="alert" className="text-bad">{describeError(pairing.error, "This connection link is unavailable.")}</p>
          : !pair ? <p className="text-muted">Loading connection…</p> : <>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="pill bg-soft">Signer {shortAddress(pair.agent)}</span><details className="text-sm text-muted"><summary className="cursor-pointer">Full address</summary><p className="mt-2 break-all font-mono">{pair.agent}</p></details></div>
            <p className="text-sm text-muted">Match this signer with the one in your terminal.</p>
            {spaces.isPending ? <p className="text-muted">Loading your Spaces…</p> : spaces.isError ? <p role="alert" className="text-bad">Your Spaces could not be loaded. Refresh to try again.</p> : !activeSpaces.length ? <><p className="text-ink-soft">Create a Space first, then return to this connection link.</p><Button asChild><Link href="/spaces/new">Create a Space</Link></Button></> : <>
              <div><label htmlFor="pair-space" className="font-semibold">Space</label><select id="pair-space" className="field mt-2" value={selected?.id ?? ""} onChange={e => { setDraftId(e.target.value); setAllocationId(""); }}>{activeSpaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              {matches.length ? <><div className="grid gap-2">{matches.map(i => <button type="button" key={i.allocationId} onClick={() => setAllocationId(i.allocationId)} className={`flex items-start gap-3 rounded-2xl border-2 p-4 text-left ${identity?.allocationId === i.allocationId ? "border-lilac bg-lilac-soft" : "border-line"}`}><AtSign className="mt-0.5 shrink-0 text-[#6544ba]" size={20}/><span className="min-w-0"><b className="break-all">{i.name}</b><span className="mt-1 block text-sm text-muted">Existing authorized agent budget</span></span></button>)}</div>
                <p className="text-sm text-muted">The tool can inspect this budget and request payments within its rules. Sensitive payments still need your approval.</p>
                <Button size="lg" loading={busy} onClick={() => void accept()}>Connect agent</Button></>
                : identities.isPending ? <p className="text-muted">Checking agent budgets…</p> : identities.isError ? <p role="alert" className="text-bad">Agent budgets could not be checked. Trying again shortly…</p> : <div className="rounded-2xl bg-soft p-5"><p className="font-semibold">Give this agent a budget</p><p className="mt-1 text-sm text-muted">Choose its name and limits, then authorize it with World ID. You’ll return here to connect.</p>
                  <Button asChild variant="soft" className="mt-4"><Link href={`/spaces/${selected!.spaceAddress}/new?for=agent&agent=${pair.agent}&pairing=${id}`}><Plus/>Set up budget</Link></Button></div>}
            </>}
          </>}
        {message ? <p role="alert" className="text-sm text-bad">{message}</p> : null}
      </div>
    </section>
  </div>;
}
