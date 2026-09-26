"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, Code2, Copy, Plug, Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { agentInstall } from "@/lib/agent-install";
import { useAccord } from "@/lib/accord";
import { describeError } from "@/lib/errors";
import { timeAgo } from "@/lib/format";
import { Button } from "./ui/button";
import { Sheet } from "./ui/sheet";

export function Commands({ text, label = "Copy commands" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { toast.error("Select the commands and copy them from here."); }
  }
  return <div className="relative rounded-2xl bg-soft p-4 pr-12">
    <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs leading-relaxed text-ink-soft"><code>{text}</code></pre>
    <button type="button" className="absolute right-3 top-3 rounded-full p-2 text-muted hover:bg-white" aria-label={copied ? "Copied" : label} onClick={() => void copy()}>{copied ? <Check size={16}/> : <Copy size={16}/>}</button>
  </div>;
}
export function AgentSetupButton() {
  const [open, setOpen] = useState(false);
  return <><Button type="button" variant="soft" size="sm" onClick={() => setOpen(true)}><Plug/>Connect your agent</Button>
    <Sheet open={open} onOpenChange={setOpen} title="Connect your agent" description="Start in your terminal, then open the connection link.">
      <Commands text={`${agentInstall}\nnpx accord init\nnpx accord connect`}/>
      <p className="mt-4 text-sm text-muted">Choose this Space in the browser to give the agent a name and budget. Its signer stays on your machine.</p>
      <Button asChild variant="ghost" className="mt-4"><Link href="/developers">SDK & MCP quickstart</Link></Button>
    </Sheet></>;
}

export function useAgentConnections(draftId: string, allocationId: string, enabled: boolean) {
  const { client, account } = useAccord();
  return useQuery({ queryKey: ["agent-connections", draftId, allocationId, account], enabled: !!client && enabled,
    queryFn: () => client!.agentConnections(draftId, allocationId), refetchInterval: enabled ? 15_000 : false });
}

/** Assistants paired with this agent through the toolkit, for the Space owner. */
export function AgentConnections({ draftId, allocationId }: { draftId: string; allocationId: string }) {
  const { client, checkSession } = useAccord();
  const connections = useAgentConnections(draftId, allocationId, true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null), [busy, setBusy] = useState(false);
  async function disconnect(id: string) {
    if (!client) return; setBusy(true);
    try { await client.disconnectAgent(id); await connections.refetch(); setDisconnecting(null); }
    catch (error) { checkSession(error); toast.error(describeError(error, "Could not disconnect this tool.")); }
    finally { setBusy(false); }
  }
  const list = connections.data?.connections ?? [];
  return <div>
    {connections.isPending ? <p className="text-sm text-muted">Loading connections…</p> : connections.isError ? <p className="text-sm text-bad">Connections could not be loaded.</p> : !list.length
      ? <p className="text-sm text-muted">No assistant connected yet.</p>
      : <ul className="grid gap-2">{list.map(c => <li key={c.id} className="flex items-center justify-between gap-3 rounded-2xl bg-soft p-3">
        <span className="flex min-w-0 items-center gap-3">
          <span className={`size-2.5 shrink-0 rounded-full ${c.revoked ? "bg-[#c9c4dd]" : c.lastSeenAt ? "bg-good" : "bg-warn"}`} aria-hidden/>
          <span className="min-w-0"><b className="block text-sm">{c.revoked ? "Disconnected" : "Agent toolkit · MCP or SDK"}</b>
            <span className="block text-xs text-muted">{c.revoked ? `Connected ${timeAgo(Date.parse(c.createdAt) / 1000)}` : c.lastSeenAt ? `Last tool call ${timeAgo(Date.parse(c.lastSeenAt) / 1000)}` : "Waiting for the first tool call"}</span></span>
        </span>
        {!c.revoked ? <button type="button" className="rounded-full p-2 text-bad hover:bg-bad-soft disabled:opacity-50" aria-label="Disconnect tooling" title="Disconnect" onClick={() => setDisconnecting(c.id)} disabled={busy}><Unplug size={17}/></button> : null}
      </li>)}</ul>}
    {disconnecting ? <div className="mt-3 rounded-2xl bg-bad-soft p-4"><p className="text-sm text-ink-soft">Disconnect this tool? To stop all agent payments, including already-issued permissions, revoke its ENS authority instead.</p><div className="mt-3 flex gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => setDisconnecting(null)}>Cancel</Button><Button size="sm" variant="soft" className="text-bad" loading={busy} onClick={() => void disconnect(disconnecting)}>Disconnect</Button></div></div> : null}
  </div>;
}

export function AgentTools({ draftId, allocationId, name, owner }: { draftId: string; allocationId: string; name: string; owner: boolean }) {
  const [open, setOpen] = useState(false);
  return <><Button type="button" size="sm" variant="soft" aria-label="Developer tools" title="Developer tools" className="max-sm:size-10 max-sm:p-0" onClick={() => setOpen(true)}><Code2/><span className="hidden sm:inline">Developer tools</span></Button>
    <Sheet open={open} onOpenChange={setOpen} title="Connect by ENS name" description={name}>
      <Commands text={`npx accord connect --agent ${name}\nnpx accord mcp config`}/>
      <p className="mt-3 text-sm text-muted">Use the local signer authorized for this agent. Copy the generated configuration into your assistant’s MCP settings.</p>
      <Link className="mt-3 inline-flex text-sm font-semibold text-[#6544ba] hover:underline" href="/developers">First time? Install the toolkit →</Link>
      {owner && open ? <div className="mt-6 border-t border-line pt-5"><h3 className="mb-3 font-semibold">Connected tools</h3><AgentConnections draftId={draftId} allocationId={allocationId}/></div> : null}
    </Sheet></>;
}
