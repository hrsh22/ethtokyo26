import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { normalize } from "viem/ens";

export type AgentWalletInput = { address: Address; name?: never } | { name: string; address?: never };
type ResolveName = (name: string) => Promise<{ name: string; address: string; chainId: number }>;

export function parseAgentWallet(input: string): AgentWalletInput {
  const value = input.trim();
  if (isAddress(value) && value !== zeroAddress) return { address: getAddress(value) };
  if (!value.toLowerCase().startsWith("0x")) {
    try {
      const name = normalize(value);
      if (name.endsWith(".eth") && name.length <= 255) return { name };
    } catch { /* Display the same short input error for malformed names. */ }
  }
  throw new Error("Enter a wallet address or a .eth name on Sepolia.");
}

/** Resolve again before authorizing a wallet; never silently follow a changed ENS address. */
export async function resolveAgentWallet(input: string, resolveName: ResolveName, expectedAddress?: Address): Promise<Address> {
  const parsed = parseAgentWallet(input);
  let address = parsed.address;
  if (parsed.name) {
    let found: Awaited<ReturnType<ResolveName>>;
    try { found = await resolveName(parsed.name); }
    catch (error) {
      const tag = error && typeof error === "object" && "_tag" in error ? error._tag : undefined;
      throw new Error(tag === "NotFound" ? "That name has no wallet on Sepolia. Try another name or paste the address."
        : tag === "BadRequest" ? "Enter a valid .eth name on Sepolia."
        : "ENS lookup is unavailable. Try again in a moment.");
    }
    if (found.chainId !== 11155111 || found.name !== parsed.name || !isAddress(found.address) || found.address === zeroAddress) {
      throw new Error("ENS returned an invalid wallet. Try another name or paste the address.");
    }
    address = getAddress(found.address);
  }
  if (!address) throw new Error("Enter a valid agent wallet.");
  if (expectedAddress && address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error("That ENS name now points to a different wallet. Check the address and confirm it again.");
  }
  return address;
}
