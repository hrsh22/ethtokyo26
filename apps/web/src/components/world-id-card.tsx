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
  const [busy, setBusy] = useState(false);
  if (status.data && !status.data.configured) return null;
  const linked = status.data?.enrolled;

  async function begin() {
    if (!client || busy) return;
    setBusy(true);
    try { setChallenge(await client.worldChallenge(linked ? "reverify" : "enroll")); setOpen(true); }
    catch (cause) { checkSession(cause); toast.error("Couldn’t start a World ID check. Try again."); }
    finally { setBusy(false); }
  }

  return <section className="card flex flex-wrap items-center gap-4 p-6" aria-labelledby="world-card-title">
    <span className={`grid size-11 place-items-center rounded-2xl ${linked ? "bg-good-soft text-good" : "bg-tang-soft text-[#e2561c]"}`}>{linked ? <Check size={20} strokeWidth={3} /> : <Fingerprint size={20} />}</span>
    <span className="min-w-[200px] flex-1">
      <h2 id="world-card-title" className="font-display text-2xl font-extrabold">{linked ? "World ID linked" : "Receiving an allowance?"}</h2>
      <span className="text-sm text-muted">{status.isPending ? "Checking your World ID status…" : linked ? "This wallet is ready to claim. Each claim still asks for a quick fresh check."
        : "Link World ID to this wallet now, so your first claim is a single check."}</span>
    </span>
    {status.data ? <Button variant={linked ? "soft" : "primary"} loading={busy} onClick={() => void begin()}>{linked ? "Check again" : "Link World ID"}</Button> : null}
    {challenge ? <WorldSession open={open} onOpenChange={setOpen}
      app_id={challenge.appId as `app_${string}`} rp_context={challenge.rpContext} environment={challenge.environment}
      existing_session_id={challenge.sessionId as `session_${string}` | undefined} require_user_presence={challenge.requireUserPresence}
      constraints={{ type: "selfie", ...(challenge.signal ? { signal: challenge.signal } : {}) }}
      handleVerify={(result) => client!.worldVerify(challenge.id, result).then(() => undefined)}
      onSuccess={() => { setOpen(false); toast.success("World ID linked to this wallet"); void cache.invalidateQueries({ queryKey: ["world-status"] }); }}
      onError={() => { setOpen(false); toast.error("World ID linking didn’t finish. Try again."); }} /> : null}
  </section>;
}
