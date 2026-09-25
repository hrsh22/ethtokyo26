"use client";

import { Check, Loader2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";
import { explorerTx } from "@/lib/use-chain-actions";

export type StepState = "waiting" | "active" | "done" | "error";
export type TxStep = { id: string; label: string; state: StepState; detail?: string; hash?: string | null };

/** Named steps for a multi-transaction action, so people know which wallet prompt they're on. */
export function useSteps(initial: Omit<TxStep, "state">[]) {
  const [steps, setSteps] = useState<TxStep[]>(() => initial.map((step) => ({ ...step, state: "waiting" })));
  const update = useCallback((id: string, patch: Partial<TxStep>) =>
    setSteps((current) => current.map((step) => step.id === id ? { ...step, ...patch } : step)), []);
  const reset = useCallback((next = initial) => setSteps(next.map((step) => ({ ...step, state: "waiting" }))), [initial]);
  /** Runs one step: marks it active, then done, and records a hash when the action returns one. */
  const run = useCallback(async <T,>(id: string, detail: string, action: () => Promise<T>) => {
    update(id, { state: "active", detail });
    try {
      const result = await action();
      update(id, { state: "done", detail: undefined, ...(typeof result === "string" && result.startsWith("0x") ? { hash: result } : {}) });
      return result;
    } catch (error) {
      update(id, { state: "error", detail: undefined });
      throw error;
    }
  }, [update]);
  return { steps, update, reset, run };
}

export function TxTracker({ steps }: { steps: TxStep[] }) {
  return <ol className="grid gap-1" aria-label="Progress">
    {steps.map((step, index) => {
      const link = step.hash ? explorerTx(step.hash) : undefined;
      return <li key={step.id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors data-[state=active]:bg-lilac-soft" data-state={step.state}
        aria-current={step.state === "active" ? "step" : undefined}>
        <span className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${
          step.state === "done" ? "bg-lime text-[#243300]" : step.state === "error" ? "bg-bad-soft text-bad" :
          step.state === "active" ? "bg-white text-ink shadow-[0_0_0_2px_var(--color-lilac)]" : "bg-soft text-muted"}`}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={step.state} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} className="grid place-items-center">
              {step.state === "done" ? <Check size={16} strokeWidth={3} /> : step.state === "error" ? <X size={16} strokeWidth={3} /> :
                step.state === "active" ? <Loader2 size={16} className="animate-spin" /> : index + 1}
            </motion.span>
          </AnimatePresence>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{step.label}</span>
          {step.detail ? <span className="block text-sm text-muted">{step.detail}</span> : null}
        </span>
        {step.hash && step.state === "done" ? link
          ? <a href={link} target="_blank" rel="noreferrer" className="text-sm font-semibold text-[#6f4bea] hover:underline">Receipt</a>
          : <span className="address text-xs text-muted" title={step.hash}>{step.hash.slice(0, 10)}…</span> : null}
      </li>;
    })}
  </ol>;
}
