import { getAddress, isAddress } from "viem";

/** Accepts a Space address or any Accord link, and opens the Space or allocation it points to. */
export function parseAccordLink(input: string): string | null {
  const text = input.trim();
  const address = text.match(/0x[a-fA-F0-9]{40}/)?.[0];
  if (!address || !isAddress(address)) return null;
  const allocation = text.match(/\/a\/([1-9][0-9]{0,77})(?:[/?#]|$)/)?.[1];
  return `/spaces/${getAddress(address)}${allocation ? `/a/${allocation}` : ""}`;
}
