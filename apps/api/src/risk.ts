import { getAddress, type Address } from "viem";

const QUICK_SCAN = "https://api.web3antivirus.io/api/public/v2/extension/account";

export type RiskScreen = {
  address: Address;
  verdict: "allow" | "block";
  toxicScore: number;
  traits: ReadonlyArray<{ name: string; risk: number; txsCount: number }>;
  checkedAt: string;
};

export class RiskScreenUnavailable extends Error {
  constructor(message = "Live Intercepta screening is unavailable") {
    super(message);
    this.name = "RiskScreenUnavailable";
  }
}

function parseResponse(value: unknown) {
  if (!value || typeof value !== "object") throw new RiskScreenUnavailable("Malformed Intercepta response");
  const result = value as Record<string, unknown>;
  if (typeof result.toxicScore !== "number" || !Number.isFinite(result.toxicScore) || result.toxicScore < 0 || !Array.isArray(result.traits)) {
    throw new RiskScreenUnavailable("Malformed Intercepta response");
  }
  const traits = result.traits.map((value) => {
    if (!value || typeof value !== "object") throw new RiskScreenUnavailable("Malformed Intercepta trait");
    const trait = value as Record<string, unknown>;
    if (typeof trait.name !== "string" || !trait.name ||
      typeof trait.risk !== "number" || !Number.isFinite(trait.risk) || trait.risk < 0 ||
      typeof trait.txsCount !== "number" || !Number.isSafeInteger(trait.txsCount) || trait.txsCount < 0) {
      throw new RiskScreenUnavailable("Malformed Intercepta trait");
    }
    return { name: trait.name, risk: trait.risk, txsCount: trait.txsCount };
  });
  return { toxicScore: result.toxicScore, traits };
}

/** The threshold is Accord policy: Intercepta does not publish an official one. */
export async function screenRecipient(
  input: string,
  options: { apiKey?: string; fetcher?: typeof fetch } = {},
): Promise<RiskScreen> {
  let address: Address;
  try { address = getAddress(input); }
  catch { throw new RiskScreenUnavailable("Invalid recipient address"); }
  const apiKey = options.apiKey ?? process.env.INTERCEPTA_API_KEY;
  if (!apiKey) throw new RiskScreenUnavailable();
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${QUICK_SCAN}/${address}/quick-scan`, {
      headers: { "X-API-KEY": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new RiskScreenUnavailable(); }
  if (!response.ok) throw new RiskScreenUnavailable(`Intercepta returned HTTP ${response.status}`);
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new RiskScreenUnavailable("Malformed Intercepta response"); }
  const parsed = parseResponse(payload);
  return {
    address,
    verdict: parsed.toxicScore === 0 && parsed.traits.length === 0 ? "allow" : "block",
    ...parsed,
    checkedAt: new Date().toISOString(),
  };
}
