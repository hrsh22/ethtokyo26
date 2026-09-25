"use client";

import { Loader2, ShieldCheck, Wallet } from "lucide-react";
import { Button } from "./ui/button";
import type { useWalletSession } from "@/lib/use-wallet-session";

export function AuthAction({ auth, connect, compact = false }: {
  auth: ReturnType<typeof useWalletSession>; connect: () => void; compact?: boolean;
}) {
  const waiting = auth.status === "connecting" || auth.status === "checking";
  if (auth.signedIn) return <span className="session-status"><ShieldCheck size={15} /> Signed in</span>;
  return <div className={compact ? "auth-action auth-action--compact" : "auth-action"}>
    {!compact && <p>{waiting ? "Restoring your wallet and checking your session…" : auth.status === "unavailable" ?
      "We couldn’t check your session. Try again in a moment." : auth.status === "disconnected" ?
      "Connect a wallet to save and manage your Spaces." : "Your wallet is connected. Sign a message to confirm it’s you. No transaction or fee."}</p>}
    <Button type="button" disabled={waiting || auth.signing} onClick={() => {
      if (auth.status === "disconnected") connect();
      else if (auth.status === "unavailable") void auth.retry();
      else void auth.signIn();
    }}>
      {waiting || auth.signing ? <Loader2 className="animate-spin" size={16} /> : <Wallet size={16} />}
      {auth.signing ? "Confirm in wallet…" : waiting ? "Checking session…" : auth.status === "unavailable" ? "Retry connection" :
        auth.status === "disconnected" ? "Connect wallet" : "Sign in"}
    </Button>
    {!compact && auth.error ? <p className="form-error" role="alert">{auth.error}</p> : null}
  </div>;
}
