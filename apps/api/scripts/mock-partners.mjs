/** Test-process-only partner responses for the local Anvil integration smoke. */
if (process.env.ACCORD_PARTNER_MOCKS !== "local-only" ||
  !/^https?:\/\/(127\.0\.0\.1|localhost):8546(?:\/|$)/.test(process.env.SEPOLIA_RPC_URL ?? "") ||
  process.env.API_PORT !== "4001") {
  throw new Error("Partner mocks require the dedicated local Anvil smoke process");
}

const fetcher = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
  if (url.origin === "https://developer.world.org" && url.pathname.startsWith("/api/v4/verify/")) {
    const proof = JSON.parse(String(init?.body ?? "{}"));
    return Response.json({ success: true, environment: proof.environment,
      session_id: proof.session_id, results: [{ identifier: "selfie", success: true }] });
  }
  if (url.origin === "https://api.web3antivirus.io" && url.pathname.endsWith("/quick-scan")) {
    const address = url.pathname.split("/").at(-2)?.toLowerCase();
    if (address === process.env.MOCK_INTERCEPTA_ERROR_ADDRESS?.toLowerCase()) {
      return Response.json({ error: "local simulated outage" }, { status: 503 });
    }
    if (address === process.env.MOCK_INTERCEPTA_BLOCK_ADDRESS?.toLowerCase()) {
      return Response.json({ toxicScore: 80,
        traits: [{ name: "known_scammer", risk: 80, txsCount: 1, description: "local fixture" }] });
    }
    return Response.json({ toxicScore: 0, traits: [] });
  }
  return fetcher(input, init);
};
