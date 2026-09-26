import type { ApprovalRequest } from "@accord/sdk";

/** Approval updates the UI; payment still requires the agent's explicit signature. */
export function paymentReview(status?: ApprovalRequest["status"]) {
  return {
    ready: status === "approved" || status === "issued",
    completed: status === "executed",
    waiting: status === "pending" || status === "verified",
    stopped: !!status && ["denied", "cancelled", "expired", "invalidated"].includes(status),
  };
}
