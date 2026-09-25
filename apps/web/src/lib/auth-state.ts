export type Session = { address: string; expiresAt: string };
export type AuthStatus = "connecting" | "disconnected" | "checking" | "unavailable" | "signed-out" | "signed-in";

export function isUnauthorized(error: unknown): boolean {
  return !!error && typeof error === "object" && "_tag" in error && error._tag === "Unauthorized";
}

export function authStatus(input: {
  walletStatus: string;
  address?: string;
  queryStatus: "pending" | "error" | "success";
  session?: Session | null;
}, now = Date.now()): AuthStatus {
  if (input.walletStatus === "connecting" || input.walletStatus === "reconnecting") return "connecting";
  if (!input.address) return "disconnected";
  if (input.queryStatus === "pending") return "checking";
  if (input.queryStatus === "error") return "unavailable";
  return input.session?.address.toLowerCase() === input.address.toLowerCase() &&
    Date.parse(input.session.expiresAt) > now ? "signed-in" : "signed-out";
}
