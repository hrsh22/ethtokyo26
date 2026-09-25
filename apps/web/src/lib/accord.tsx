"use client";

import { createAccordClient, type AccordClient } from "@accord/sdk";
import { useAppKit, useAppKitState } from "@reown/appkit/react";
import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSwitchChain } from "wagmi";
import { isUnauthorized } from "./auth-state";
import { useWalletSession } from "./use-wallet-session";

export const SEPOLIA_CHAIN_ID = 11_155_111;
const walletPickerConfigured = !!process.env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim();

function useAccordState() {
  const clientQuery = useQuery({ queryKey: ["accord-client"], queryFn: () => createAccordClient("/api"), staleTime: Infinity });
  const client = clientQuery.data;
  const config = useQuery({ queryKey: ["accord-config"], queryFn: () => client!.config(), enabled: !!client, staleTime: 5 * 60_000 });
  const auth = useWalletSession(client);
  const { open } = useAppKit();
  const { open: walletPickerOpen } = useAppKitState();
  const { switchChainAsync } = useSwitchChain();
  // Connecting is only half of getting in; remember the intent so the
  // sign-in message follows straight after the wallet picker closes.
  const wantsSession = useRef(false);
  const [switching, setSwitching] = useState(false);
  const { status, signIn } = auth;

  useEffect(() => {
    if (status === "signed-out" && wantsSession.current) {
      wantsSession.current = false;
      void signIn();
    }
    if (status === "signed-in") wantsSession.current = false;
  }, [status, signIn]);

  const start = useCallback(() => {
    auth.clearError();
    if (auth.status === "unavailable") { void auth.retry(); return; }
    if (auth.status === "signed-out") { void auth.signIn(); return; }
    if (!walletPickerConfigured) {
      toast.error("Wallet connection is not configured here. Set NEXT_PUBLIC_REOWN_PROJECT_ID and restart the web app.");
      return;
    }
    wantsSession.current = true;
    void open({ view: "Connect" });
  }, [auth, open]);

  const switchNetwork = useCallback(async () => {
    setSwitching(true);
    try { await switchChainAsync({ chainId: SEPOLIA_CHAIN_ID }); }
    catch { toast.error("The network switch didn't finish. Choose Sepolia in your wallet and try again."); }
    finally { setSwitching(false); }
  }, [switchChainAsync]);

  const { connection } = auth;
  return {
    client,
    config,
    auth,
    account: connection.address,
    wrongNetwork: !!connection.address && connection.chainId !== undefined && connection.chainId !== SEPOLIA_CHAIN_ID,
    walletPickerOpen,
    start,
    openAccount: () => void open({ view: "Account" }),
    switchNetwork,
    switching,
    /** Call when an API request fails so an expired session shows the sign-in prompt again. */
    checkSession: (error: unknown) => { if (isUnauthorized(error)) auth.expire(); },
  };
}

export type AccordState = ReturnType<typeof useAccordState>;
const AccordContext = createContext<AccordState | null>(null);

export function AccordProvider({ children }: { children: React.ReactNode }) {
  return <AccordContext.Provider value={useAccordState()}>{children}</AccordContext.Provider>;
}

export function useAccord() {
  const value = useContext(AccordContext);
  if (!value) throw new Error("useAccord must be used inside AccordProvider");
  return value;
}

/** For components that need a signed-in client; callers render a sign-in prompt otherwise. */
export function useSignedInClient(): AccordClient | undefined {
  const { client, auth } = useAccord();
  return auth.signedIn ? client : undefined;
}
