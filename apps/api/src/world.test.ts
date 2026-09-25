import { describe, expect, it } from "vitest";
import { acceptedVerification, parseSessionResult } from "./world";

const sessionId = `session_${"a".repeat(128)}`;
const environment = process.env.WORLD_ENVIRONMENT === "production" ? "production" : "staging";
const selfie = {
  identifier: "selfie",
  issuer_schema_id: 11,
  session_nullifier: ["0x1", "0x2"],
  signal_hash: "0x3",
};

describe("World session verification boundary", () => {
  it("rejects a batch that could bind one response while another verifies", () => {
    const result = {
      protocol_version: "4.0",
      nonce: "nonce",
      session_id: sessionId,
      environment,
      responses: [selfie],
    };
    expect(parseSessionResult(result)).not.toBeNull();
    expect(parseSessionResult({ ...result, responses: [selfie, { ...selfie, signal_hash: "0x4" }] })).toBeNull();
    expect(parseSessionResult({ ...result, session_id: `session_${"a".repeat(127)}` })).toBeNull();
  });

  it("requires the sole verifier result to be the successful selfie proof", () => {
    const result = { success: true, environment, session_id: sessionId,
      results: [{ identifier: "selfie", success: true }] };
    expect(acceptedVerification(result, sessionId)).toBe(true);
    expect(acceptedVerification({ ...result,
      results: [...result.results, { identifier: "other", success: false }] }, sessionId)).toBe(false);
    expect(acceptedVerification({ ...result, results: [{ identifier: "other", success: true }] }, sessionId)).toBe(false);
  });
});
