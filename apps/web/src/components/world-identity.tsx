"use client";

import type { AccordClient } from "@accord/sdk";
import { WorldSession } from "@/components/world-session";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Fingerprint, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { Address } from "viem";
import { Button } from "@/components/ui/button";

type Challenge = Awaited<ReturnType<AccordClient["worldChallenge"]>>;

export function WorldIdentity({ client, signedIn, address }: { client?: AccordClient; signedIn: boolean; address?: Address }) {
  const queryClient = useQueryClient();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ["world-status", address],
    queryFn: () => client!.worldStatus(),
    enabled: !!client && signedIn,
    retry: false,
  });

  async function begin() {
    if (!client || !status.data?.configured) return;
    setBusy(true); setMessage(null);
    try {
      const next = await client.worldChallenge(status.data.enrolled ? "reverify" : "enroll");
      setChallenge(next);
      setOpen(true);
    } catch {
      setMessage("Could not start a World ID check. Try again with a fresh session.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="identity-section" aria-labelledby="world-heading">
    <div className="identity-icon"><Fingerprint size={24} strokeWidth={1.7} /></div>
    <div className="identity-copy"><h2 id="world-heading">Verify with World ID</h2><p>{!signedIn ? "Sign in with your wallet to connect a World ID session." : status.isPending ? "Checking your verification status…" : status.isError ? "Verification status is temporarily unavailable." : !status.data?.configured ? "World ID verification is temporarily unavailable." : status.data.enrolled ? "Your wallet is linked. Each claim asks for a fresh verification." : "Link your World ID session to this wallet before your first claim. ENS identifies the recipient; World ID checks the human claiming."}</p>{message && <p className="identity-message" role="status">{message}</p>}</div>
    <div className="identity-action">{status.data?.enrolled && <span className="identity-linked"><ShieldCheck size={15} /> World ID linked</span>}<Button onClick={begin} disabled={!signedIn || !status.data?.configured || busy} variant="outline">{busy ? "Preparing…" : status.data?.enrolled ? "Confirm again" : "Connect World ID"} <ArrowRight size={15} /></Button></div>
    {challenge && <WorldSession
      open={open}
      onOpenChange={setOpen}
      app_id={challenge.appId as `app_${string}`}
      rp_context={challenge.rpContext}
      environment={challenge.environment}
      existing_session_id={challenge.sessionId as `session_${string}` | undefined}
      require_user_presence={challenge.requireUserPresence}
      constraints={{ type: "selfie", ...(challenge.signal ? { signal: challenge.signal } : {}) }}
      handleVerify={async (result) => {
        if (!client) throw new Error("Client unavailable");
        await client.worldVerify(challenge.id, result);
      }}
      onSuccess={async () => {
        setMessage("World ID verification succeeded and is linked to this wallet.");
        await queryClient.invalidateQueries({ queryKey: ["world-status"] });
      }}
      onError={() => setMessage("World ID verification did not complete. Start a new check to retry.")}
    />}
  </section>;
}
