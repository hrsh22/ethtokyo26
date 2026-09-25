import { describe, expect, it, vi } from "vitest";
import { RiskScreenUnavailable, screenRecipient } from "./risk";

const address = "0x000000000000000000000000000000000000dEaD";
const key = "test-key";
function answer(body: unknown, status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe("live Intercepta quick scan", () => {
  it("allows only an explicitly clean scan and sends the key in a header", async () => {
    const fetcher = answer({ toxicScore: 0, traits: [] });
    const result = await screenRecipient(address, { apiKey: key, fetcher });
    expect(result.verdict).toBe("allow");
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `https://api.web3antivirus.io/api/public/v2/extension/account/${address}/quick-scan`,
      expect.objectContaining({ headers: { "X-API-KEY": key, Accept: "application/json" } }),
    );
  });

  it("blocks any nonzero score or trait", async () => {
    expect((await screenRecipient(address, { apiKey: key, fetcher: answer({ toxicScore: 1, traits: [] }) })).verdict).toBe("block");
    expect((await screenRecipient(address, { apiKey: key, fetcher: answer({ toxicScore: 0, traits: [{ name: "known_scammer", risk: 1, txsCount: 2 }] }) })).verdict).toBe("block");
  });

  it("fails closed for missing key, HTTP failure, malformed data, and network failure", async () => {
    await expect(screenRecipient(address, { apiKey: "" })).rejects.toBeInstanceOf(RiskScreenUnavailable);
    await expect(screenRecipient(address, { apiKey: key, fetcher: answer({}, 401) })).rejects.toBeInstanceOf(RiskScreenUnavailable);
    await expect(screenRecipient(address, { apiKey: key, fetcher: answer({ toxicScore: 0, traits: [{}] }) })).rejects.toBeInstanceOf(RiskScreenUnavailable);
    await expect(screenRecipient(address, { apiKey: key, fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")) })).rejects.toBeInstanceOf(RiskScreenUnavailable);
  });
});
