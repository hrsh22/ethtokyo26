import { paymentDecision } from "@accord/sdk";

export function tagOf(error: unknown): string | undefined {
  return error && typeof error === "object" && "_tag" in error && typeof error._tag === "string" ? error._tag : undefined;
}

/** A short, actionable message for the UI. Wallet libraries append calldata to errors; drop it. */
export function describeError(error: unknown, fallback: string): string {
  const decision = paymentDecision(error);
  if (decision) return decision.reason;
  const tag = tagOf(error);
  if (tag === "AgentActionError" && error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  if (tag === "Forbidden") return `${fallback} Check this allocation's access, limits and current permissions.`;
  if (tag === "ServiceUnavailable") return "A verification service is unavailable, so nothing was submitted. Try again in a moment.";
  if (tag === "Unauthorized") return "Your session expired. Sign in again and retry.";
  if (tag) return fallback;
  const message = error instanceof Error ? error.message : "";
  const short = error && typeof error === "object" && "shortMessage" in error && typeof error.shortMessage === "string" ? error.shortMessage : "";
  if (/user (rejected|denied)|rejected the request/i.test(short || message)) return "You cancelled the request in your wallet. Nothing was sent.";
  try {
    const api = JSON.parse(message) as { _tag?: string };
    if (api._tag) return describeError(api, fallback);
  } catch { /* not a serialized API error */ }
  return short || message.split(/\n\s*(?:Request Arguments|Details):/)[0] || fallback;
}
