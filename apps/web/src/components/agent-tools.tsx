"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, Code2, Copy, Plug, Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAccord } from "@/lib/accord";
import { describeError } from "@/lib/errors";
import { Button } from "./ui/button";
import { Sheet } from "./ui/sheet";

export const agentInstall = "npm install https://accord.hrsh.dev/downloads/accord-agent-0.1.0.tgz";
function Commands({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { toast.error("Select the commands and copy them from here."); }
  }
  return <div className="relative rounded-2xl bg-soft p-4 pr-12">
    <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs leading-relaxed text-ink-soft"><code>{text}</code></pre>
    <button type="button" className="absolute right-3 top-3 rounded-full p-2 text-muted hover:bg-white" aria-label="Copy commands" onClick={() => void copy()}>{copied ? <Check size={16}/> : <Copy size={16}/>}</button>
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
export function AgentTools({ draftId, allocationId, name, owner }: { draftId: string; allocationId: string; name: string; owner: boolean }) {
  const { client, account, checkSession } = useAccord();
  const [open, setOpen] = useState(false), [disconnecting, setDisconnecting] = useState<string | null>(null);
  const connections = useQuery({ queryKey: ["agent-connections", draftId, allocationId, account], enabled: !!client && owner && open,
    queryFn: () => client!.agentConnections(draftId, allocationId), refetchInterval: open ? 15_000 : false });
  async function disconnect(id: string) {
    if (!client) return; setDisconnecting(id);
    try { await client.disconnectAgent(id); await connections.refetch(); }
    catch (error) { checkSession(error); toast.error(describeError(error, "Could not disconnect this tool.")); }
    finally { setDisconnecting(null); }
  }
  return <><Button type="button" size="sm" variant="soft" onClick={() => setOpen(true)}><Code2/>Developer tools</Button>
    <Sheet open={open} onOpenChange={setOpen} title="Connect by ENS name" description={name}>
      <Commands text={`npx accord connect --agent ${name}\nnpx accord mcp config`}/>
      <p className="mt-3 text-sm text-muted">Use the local signer authorized for this agent. Copy the generated configuration into your assistant’s MCP settings.</p>
      <Link className="mt-3 inline-flex text-sm font-semibold text-[#6544ba] hover:underline" href="/developers">First time? Install the toolkit →</Link>
      {owner ? <div className="mt-6 border-t border-line pt-5"><h3 className="font-semibold">Connected tools</h3>
        {connections.isPending ? <p className="mt-2 text-sm text-muted">Loading connections…</p> : connections.isError ? <p className="mt-2 text-sm text-bad">Connections could not be loaded.</p> : !connections.data?.connections.length ? <p className="mt-2 text-sm text-muted">No tools connected yet.</p> :
          <ul className="mt-3 grid gap-3">{connections.data.connections.map(c => <li key={c.id} className="flex items-center justify-between gap-3 rounded-2xl bg-soft p-3">
            <div className="min-w-0"><p className="text-sm font-semibold">{c.revoked ? "Disconnected" : "Agent toolkit"}</p><p className="text-xs text-muted">{c.lastSeenAt ? `Last seen ${new Date(c.lastSeenAt).toLocaleString()}` : "Waiting for the first tool call"}</p></div>
            {!c.revoked ? <button type="button" className="rounded-full p-2 text-bad hover:bg-bad-soft disabled:opacity-50" aria-label="Disconnect tooling" onClick={() => setDisconnecting(c.id)} disabled={!!disconnecting}><Unplug size={17}/></button> : null}
          </li>)}</ul>}
        {disconnecting ? <div className="mt-4 rounded-2xl bg-bad-soft p-4"><p className="text-sm text-ink-soft">Disconnect this tool? To stop all agent payments, including already-issued permissions, revoke its ENS authority in the Space.</p><div className="mt-3 flex gap-2"><Button size="sm" variant="ghost" onClick={() => setDisconnecting(null)}>Cancel</Button><Button size="sm" variant="soft" className="text-bad" onClick={() => void disconnect(disconnecting)}>Disconnect</Button></div></div> : null}
      </div> : null}
    </Sheet></>;
}
