import type { Decision } from "@accord/sdk";

export function PaymentDecision({ decision, settled = false }: { decision: Decision; settled?: boolean }) {
  const title = decision.outcome === "allow" ? settled ? "Payment confirmed" : "Checks passed · awaiting payment" : decision.outcome === "block" ? "Payment blocked" : "Payment paused";
  return <div className={`payment-decision payment-decision--${decision.outcome}`} role="status">
    <strong>{title}</strong><p>{decision.reason}</p>
    {process.env.NEXT_PUBLIC_ACCORD_LOCAL_E2E === "1" ? <small>Simulated partner response · local test only</small> : null}
    {decision.toxicScore !== undefined ? <small>Recipient screening: toxic score {decision.toxicScore}{decision.traits.length > 0 ? ` · ${decision.traits.map((item) => item.replaceAll("_", " ")).join(", ")}` : " · no reported risk traits"}. Screening data is for mainnet; settlement is on the configured test chain.</small> : null}
    <small>Checked {new Date(decision.checkedAt).toLocaleTimeString()}</small>
  </div>;
}
