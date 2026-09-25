import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";
const account = privateKeyToAccount(generatePrivateKey());
const origin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

async function post(path: string, body: object, cookie?: string, requestOrigin = origin) {
  return fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: requestOrigin,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const challengeResponse = await post("/v1/auth/challenge", { address: account.address });
assert.equal(challengeResponse.status, 200);
const challenge = (await challengeResponse.json()) as { id: string; message: string };
const signature = await account.signMessage({ message: challenge.message });

const verifyResponse = await post("/v1/auth/verify", {
  id: challenge.id,
  address: account.address,
  signature,
  client: "browser",
});
assert.equal(verifyResponse.status, 200);
const setCookie = verifyResponse.headers.get("set-cookie");
assert.ok(setCookie?.includes("accord_session="));
assert.ok(setCookie.includes("HttpOnly"));
const cookie = setCookie.split(";")[0];
assert.ok(cookie);

const sessionResponse = await fetch(`${apiUrl}/v1/auth/session`, { headers: { cookie } });
assert.equal(sessionResponse.status, 200);
const session = (await sessionResponse.json()) as { address: string };
assert.equal(session.address.toLowerCase(), account.address.toLowerCase());

const draftResponse = await post(
  "/v1/spaces/drafts",
  { name: "Tokyo research", templateId: "research-budget" },
  cookie,
);
assert.equal(draftResponse.status, 200);
const draft = (await draftResponse.json()) as { id: string };
const spacesResponse = await fetch(`${apiUrl}/v1/spaces`, { headers: { cookie } });
assert.equal(spacesResponse.status, 200);
const spaces = (await spacesResponse.json()) as { spaces: Array<{ id: string }> };
assert.ok(spaces.spaces.some((space) => space.id === draft.id));

const blankNameResponse = await post(
  "/v1/spaces/drafts",
  { name: "  ", templateId: "research-budget" },
  cookie,
);
assert.equal(blankNameResponse.status, 400);

const replayResponse = await post("/v1/auth/verify", {
  id: challenge.id,
  address: account.address,
  signature,
  client: "browser",
});
assert.equal(replayResponse.status, 401);

const wrongOriginResponse = await post(
  "/v1/spaces/drafts",
  { name: "Should fail", templateId: "research-budget" },
  cookie,
  "https://untrusted.example",
);
assert.equal(wrongOriginResponse.status, 403);

const worldStatusResponse = await fetch(`${apiUrl}/v1/world/status`, { headers: { cookie } });
assert.equal(worldStatusResponse.status, 200);
const worldStatus = (await worldStatusResponse.json()) as { configured: boolean; enrolled: boolean };
assert.equal(worldStatus.enrolled, false);
if (worldStatus.configured) {
  const worldChallengeResponse = await post("/v1/world/challenge", { mode: "enroll" }, cookie);
  assert.equal(worldChallengeResponse.status, 200);
  const worldChallenge = (await worldChallengeResponse.json()) as {
    id: string;
    appId: string;
    signal: string;
    rpContext: { nonce: string; signature: string };
  };
  assert.ok(worldChallenge.appId.startsWith("app_"));
  assert.ok(worldChallenge.rpContext.nonce.startsWith("0x"));
  assert.ok(worldChallenge.rpContext.signature.startsWith("0x"));
  assert.equal(worldChallenge.signal, `accord:wallet:${account.address.toLowerCase()}`);
  const invalidWorldProof = await post("/v1/world/verify", {
    id: worldChallenge.id,
    result: { protocol_version: "4.0", nonce: worldChallenge.rpContext.nonce },
  }, cookie);
  assert.equal(invalidWorldProof.status, 401);
  const wrongSignalProof = await post("/v1/world/verify", {
    id: worldChallenge.id,
    result: { protocol_version: "4.0", nonce: worldChallenge.rpContext.nonce,
      session_id: "session_abcd", environment: process.env.WORLD_ENVIRONMENT ?? "staging",
      responses: [{ identifier: "selfie", issuer_schema_id: 11,
        session_nullifier: ["0x01", "0x02"], signal_hash: "0x01" }] },
  }, cookie);
  assert.equal(wrongSignalProof.status, 401);
}

console.log("Wallet sign-in, session, draft, replay, origin and World ID rejection checks passed.");
