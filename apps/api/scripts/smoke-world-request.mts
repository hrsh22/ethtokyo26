/** Check that a live API challenge can start a World IDKit Selfie Check session. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { IDKit } from "@worldcoin/idkit-core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const apiUrl = process.env.API_URL ?? "http://127.0.0.1:4000";
const environment = process.env.WORLD_ENVIRONMENT === "production" ? "production" : "staging";
const account = privateKeyToAccount(generatePrivateKey());

async function post(path: string, body: object, token?: string) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const value = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(value)}`);
  return value;
}

const challenge = await post("/v1/auth/challenge", { address: account.address });
const signature = await account.signMessage({ message: String(challenge.message) });
const signedIn = await post("/v1/auth/verify", {
  id: challenge.id, address: account.address, signature, client: "agent",
});
assert.equal(typeof signedIn.token, "string");

const world = await post("/v1/world/challenge", { mode: "enroll" }, signedIn.token);
assert.equal(world.signal, `accord:wallet:${account.address.toLowerCase()}`);
assert.equal(world.environment, environment);
const rpContext = world.rpContext as {
  rp_id: `rp_${string}`; nonce: `0x${string}`; created_at: number;
  expires_at: number; signature: `0x${string}`;
};
// IDKit loads its bundled WASM via fetch(file://), which Node's fetch does not support.
// Keep the shim scoped to this smoke process; browser IDKit uses its normal loader.
const fetcher = globalThis.fetch;
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  if (input instanceof URL && input.protocol === "file:") {
    return readFile(fileURLToPath(input)).then((bytes) => new Response(bytes, {
      headers: { "content-type": "application/wasm" },
    }));
  }
  return fetcher(input, init);
}) as typeof fetch;
let request: Awaited<ReturnType<ReturnType<typeof IDKit.createSession>["constraints"]>>;
try {
  request = await IDKit.createSession({
    app_id: world.appId as `app_${string}`,
    rp_context: rpContext,
    environment,
  }).constraints({ type: "selfie", signal: String(world.signal) });
} finally {
  globalThis.fetch = fetcher;
}
assert.ok(request.connectorURI.length > 0, "IDKit did not return a connector URI");
assert.ok(request.requestId.length > 0, "IDKit did not return a request ID");
console.log("Live World IDKit Selfie Check session request created; no proof was claimed.");
