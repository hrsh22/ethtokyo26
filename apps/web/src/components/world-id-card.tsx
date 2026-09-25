"use client";

import type { AccordClient } from "@accord/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Fingerprint } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { WorldSession } from "@/components/world-session";
import { useAccord } from "@/lib/accord";
import { Button } from "./ui/button";

type Challenge = Awaited<ReturnType<AccordClient["worldChallenge"]>>;

/** Link World ID to this wallet ahead of time, so a first claim is one check instead of two. */
export function WorldIdCard() {
  const { client, account, checkSession } = useAccord();
  const cache = useQueryClient();
  const status = useQuery({ queryKey: ["world-status", account], queryFn: () => client!.worldStatus(), enabled: !!client, retry: false });
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"link" | "unlink" | null>(null);
  if (status.data && !status.data.configured) return null;
  const linked = status.data?.enrolled;

  async function begin() {
    if (!client || busy) return;
    setBusy("link");
    try { setChallenge(await client.worldChallenge("enroll")); setOpen(true); }
    catch (cause) { checkSession(cause); toast.error("Couldn’t start a World ID check. Try again."); }
    finally { setBusy(null); }
  }

  async function unlink() {
    if (!client || busy || !linked) return;
    setBusy("unlink");
    try {
      await client.worldUnlink();
      setOpen(false);
      setChallenge(null);
      await cache.invalidateQueries({ queryKey: ["world-status", account] });
      toast.success("World ID unlinked from this wallet");
    } catch (cause) {
      checkSession(cause);
      toast.error("Couldn’t unlink World ID. Try again.");
    } finally { setBusy(null); }
  }

  return <section className="card flex flex-col items-start gap-5 p-6" aria-labelledby="world-card-title">
    <div className="flex items-start gap-4">
      <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${linked ? "bg-good-soft text-good" : "bg-tang-soft text-[#e2561c]"}`}>{linked ? <Check size={20} strokeWidth={3} /> : <Fingerprint size={20} />}</span>
      <div>
        <h2 id="world-card-title" className="font-display text-2xl font-extrabold">{linked ? "World ID linked" : "Receiving an allowance?"}</h2>
        <p className="text-sm text-muted">{status.isPending ? "Checking World ID…" : linked ? "Ready to claim." : "Link World ID before your first claim."}</p>
      </div>
    </div>
    {status.data ? linked
      ? <button type="button" className="text-sm font-medium text-bad underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bad disabled:opacity-45"
          disabled={!!busy} aria-busy={busy === "unlink"} onClick={() => void unlink()}>{busy === "unlink" ? "Unlinking…" : "Unlink World ID"}</button>
      : <Button loading={busy === "link"} disabled={!!busy} onClick={() => void begin()}>Link World ID</Button>
      : null}
    {challenge ? <WorldSession open={open} onOpenChange={setOpen}
      app_id={challenge.appId as `app_${string}`} rp_context={challenge.rpContext} environment={challenge.environment}
      existing_session_id={challenge.sessionId as `session_${string}` | undefined} require_user_presence={challenge.requireUserPresence}
      constraints={{ type: "selfie", ...(challenge.signal ? { signal: challenge.signal } : {}) }}
      handleVerify={(result) => client!.worldVerify(challenge.id, result).then(() => undefined)}
      onSuccess={() => { setOpen(false); toast.success("World ID linked to this wallet"); void cache.invalidateQueries({ queryKey: ["world-status"] }); }}
      onError={() => { setOpen(false); toast.error("World ID linking didn’t finish. Try again."); }} /> : null}
  </section>;
}
