"use client";

import { motion } from "motion/react";
import { Wallet } from "lucide-react";
import { useAccord } from "@/lib/accord";
import { Button } from "./ui/button";

/** Shown wherever an action needs a signed-in wallet. Connect and sign-in run as one step. */
export function SignInCard({ title = "Connect to continue", body, compact = false }: { title?: string; body?: string; compact?: boolean }) {
  const { auth, start } = useAccord();
  const waiting = auth.status === "connecting" || auth.status === "checking";
  const label = auth.signing ? "Confirm in your wallet" : waiting ? "Checking your session" : auth.status === "unavailable" ? "Try again"
    : auth.status === "signed-out" ? "Sign in with wallet" : "Connect wallet";
  const hint = auth.status === "signed-out"
    ? "Your wallet is connected. Sign a message to prove it's you."
    : auth.status === "unavailable" ? "We couldn't reach Accord to check your session."
    : body ?? "Connect a wallet, then sign one message.";
  return <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
    className={`card relative overflow-hidden ${compact ? "p-6" : "p-8 sm:p-10"}`} aria-labelledby="sign-in-title">
    <div className="blob -right-16 -top-20 size-64 bg-lilac/40" />
    <div className="blob -bottom-24 left-10 size-56 bg-tang/30" />
    <div className="relative">
      <span className="mb-5 grid size-14 place-items-center rounded-2xl bg-ink text-white"><Wallet /></span>
      <h2 id="sign-in-title" className={`font-display font-extrabold leading-none ${compact ? "text-3xl" : "text-4xl"}`}>{title}</h2>
      <p className="mt-3 max-w-md text-ink-soft">{hint}</p>
      <Button size="lg" className="mt-6" onClick={start} loading={waiting || auth.signing}>{label}</Button>
      {auth.error ? <p role="alert" className="mt-3 text-sm font-medium text-bad">{auth.error}</p> : null}
    </div>
  </motion.section>;
}
