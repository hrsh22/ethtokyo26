import { parseUnits } from "viem";

export type Parsed = { ok: true; value: bigint } | { ok: false; error: string };

/** Parses a positive token amount typed by a person. Rejects anything the token can't represent. */
export function parseAmount(input: string, decimals: number | undefined, label = "Amount"): Parsed {
  const text = input.trim().replaceAll(",", "");
  if (decimals === undefined) return { ok: false, error: "Token details are still loading." };
  if (!text) return { ok: false, error: `${label} is required.` };
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(text)) return { ok: false, error: `${label} must be a number, like 10 or 2.5.` };
  // parseUnits rounds extra decimals; refuse them instead so nobody funds a different amount.
  if ((text.split(".")[1]?.length ?? 0) > decimals) return { ok: false, error: `${label} has more decimal places than this token allows.` };
  const value = parseUnits(text, decimals);
  if (value <= BigInt(0)) return { ok: false, error: `${label} must be more than zero.` };
  return { ok: true, value };
}
