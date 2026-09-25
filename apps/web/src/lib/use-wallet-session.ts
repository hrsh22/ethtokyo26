"use client";

import type { AccordClient } from "@accord/sdk";
import { getAccount } from "@wagmi/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useAccount, useConfig, useSignMessage, useSwitchChain } from "wagmi";
import { authStatus, isUnauthorized } from "./auth-state";

export function useWalletSession(client?: AccordClient) {
  const connection = useAccount();
  const config = useConfig();
  const cache = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const inFlight = useRef(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addressKey = connection.address?.toLowerCase();
  const key = ["session", addressKey];
  const expire = useCallback(() => cache.setQueryData(["session", addressKey], null), [cache, addressKey]);
  const session = useQuery({
    queryKey: key,
    queryFn: async () => {
      try { return await client!.session(); }
      catch (error) { if (isUnauthorized(error)) return null; throw error; }
    },
    enabled: !!client && connection.status === "connected",
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
  });
  const status = authStatus({ walletStatus: connection.status, address: connection.address,
    queryStatus: session.status, session: session.data });

  async function signIn() {
    if (!client || !connection.address || inFlight.current) return false;
    const address = connection.address;
    inFlight.current = true;
    setSigning(true); setError(null);
    try {
      if (connection.chainId !== 11155111) await switchChainAsync({ chainId: 11155111 });
      const challenge = await client.createChallenge(address);
      const signature = await signMessageAsync({ message: challenge.message, account: address });
      if (getAccount(config).address?.toLowerCase() !== address.toLowerCase()) {
        throw new Error("Wallet changed. Sign in with the selected account.");
      }
      await client.verifyChallenge({ id: challenge.id, address, signature, client: "browser" });
      // Read the cookie-backed session before showing success. The wallet
      // signature alone does not prove that the browser saved the session.
      await cache.cancelQueries({ queryKey: ["session"] });
      const verified = await client.session();
      if (verified.address.toLowerCase() !== address.toLowerCase()) throw new Error("Session does not match the wallet.");
      cache.setQueryData(["session", address.toLowerCase()], verified);
      await cache.invalidateQueries({ queryKey: ["spaces"] });
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(message.startsWith("Wallet changed") ? message :
        "Sign-in did not complete. Approve the message in your wallet and try again.");
      return false;
    } finally { inFlight.current = false; setSigning(false); }
  }

  return { connection, status, signedIn: status === "signed-in", signing, error, signIn,
    clearError: () => setError(null), retry: () => session.refetch(),
    expire };
}
