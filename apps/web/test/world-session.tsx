"use client";

import type { IDKitSessionWidgetProps } from "@worldcoin/idkit";
import type { IDKitResultSession } from "@worldcoin/idkit-core";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { useState } from "react";

const randomHex = (length: number) => Array.from(crypto.getRandomValues(new Uint8Array(length)), (byte) => byte.toString(16).padStart(2, "0")).join("");

export function WorldSession(props: IDKitSessionWidgetProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!props.open) return null;
  const allowed = process.env.NEXT_PUBLIC_ACCORD_LOCAL_E2E === "1" &&
    window.location.origin === "http://localhost:3001" && props.app_id === "app_local_anvil" &&
    props.environment === "staging" && props.rp_context.rp_id === "rp_local_anvil";

  async function verify() {
    if (!allowed || !("type" in props.constraints) || props.constraints.type !== "selfie") return;
    setBusy(true); setError(null);
    const result: IDKitResultSession = {
      protocol_version: "4.0", nonce: props.rp_context.nonce,
      session_id: props.existing_session_id ?? `session_${randomHex(64)}`,
      environment: "staging", user_presence_completed: true,
      responses: [{ identifier: "selfie", issuer_schema_id: 11, proof: [],
        expires_at_min: 0, sybil_score: 0,
        signal_hash: hashSignal(props.constraints.signal ?? ""),
        session_nullifier: [`0x${randomHex(32)}`, `0x${randomHex(32)}`] }],
    };
    try {
      await props.handleVerify?.(result);
      props.onOpenChange(false);
      await props.onSuccess(result);
    } catch { setError("Local verification failed. Inspect the test API."); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop"><div className="draft-modal" role="dialog" aria-modal="true" aria-labelledby="local-world-title">
    <h2 id="local-world-title">Simulated World check</h2>
    <p>Local E2E test only. This generates a fixture proof for the isolated Anvil API; it does not verify a real person.</p>
    {!allowed && <p role="alert">Test verification is disabled outside the isolated local setup.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" onClick={() => props.onOpenChange(false)}>Cancel</button><button type="button" disabled={!allowed || busy} onClick={verify}>{busy ? "Verifying…" : "Complete test verification"}</button></div>
  </div></div>;
}
