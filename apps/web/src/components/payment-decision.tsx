import type { Decision } from "@accord/sdk";
import { Ban, CircleCheck, CirclePause } from "lucide-react";

/** The screening and mandate verdict behind a payment, in the agent owner's terms. */
export function PaymentDecision({ decision, settled = false }: { decision: Decision; settled?: boolean }) {
  const allow = decision.outcome === "allow";
  const block = decision.outcome === "block";
  const Icon = allow ? CircleCheck : block ? Ban : CirclePause;
  const title = allow ? settled ? "Payment confirmed" : "Checks passed" : block ? "Payment blocked" : "Payment paused";
  return <div role="status" className={`rounded-3xl p-4 ${allow ? "bg-good-soft" : block ? "bg-bad-soft" : "bg-warn-soft"}`}>
    <div className={`flex items-center gap-2 font-semibold ${allow ? "text-good" : block ? "text-bad" : "text-warn"}`}><Icon size={18} />{title}</div>
    <p className="mt-1 text-sm text-ink-soft">{decision.reason}</p>
    {decision.toxicScore !== undefined ? <p className="mt-2 text-xs text-muted">Recipient screening: risk score {decision.toxicScore}
      {decision.traits.length > 0 ? `, ${decision.traits.map((item) => item.replaceAll("_", " ")).join(", ")}` : ", no risk traits reported"}. Screening data is from mainnet; settlement is on the test chain.</p> : null}
    <p className="mt-1 text-xs text-muted">Checked {new Date(decision.checkedAt).toLocaleTimeString()}{process.env.NEXT_PUBLIC_ACCORD_LOCAL_E2E === "1" ? ". Simulated partner response, local test only." : ""}</p>
  </div>;
}
