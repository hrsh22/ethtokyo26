"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { TriangleAlert, Wallet } from "lucide-react";
import { useAccord } from "@/lib/accord";
import { shortAddress } from "@/lib/format";
import { keyPalette } from "@/lib/palette";
import { useWalletName } from "@/lib/use-wallet-name";
import { Avatar, Logo } from "./avatar";
import { Button } from "./ui/button";

export function AppNav({ landing = false }: { landing?: boolean }) {
  const path = usePathname();
  const links = landing
    ? [{ href: "#how", label: "How it works" }, { href: "#safety", label: "Safety" }, { href: "/demo", label: "Demo" }]
    : [{ href: "/spaces", label: "Spaces" }, { href: "/demo", label: "Demo" }];
  return <>
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2">Skip to content</a>
    <header className="sticky top-3 z-30 mx-3 mt-3 sm:mx-6 sm:mt-4">
      <nav aria-label="Primary" className="mx-auto flex max-w-[1240px] items-center gap-2 rounded-full bg-white/85 py-2 pl-5 pr-2 shadow-[0_14px_34px_-24px_rgb(22_18_43/0.45),inset_0_0_0_1px_rgb(255_255_255/0.9)] backdrop-blur-xl sm:gap-5">
        <Link href="/" aria-label="Accord home" className="mr-1 shrink-0"><Logo /></Link>
        <div className="hidden items-center gap-1 md:flex">
          {links.map((link) => {
            const active = !landing && (link.href === "/spaces" ? path === "/spaces" || path === "/spaces/new" : path.startsWith(link.href));
            return <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}
              className={`rounded-full px-4 py-2 font-medium transition-colors ${active ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>{link.label}</Link>;
          })}
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {landing ? <Button asChild variant="light" size="sm" className="hidden sm:inline-flex"><Link href="/spaces">Open app</Link></Button> : null}
          <AuthButton />
        </div>
      </nav>
    </header>
    <NetworkBanner />
  </>;
}

export function AuthButton() {
  const { auth, start, openAccount } = useAccord();
  const address = auth.connection.address;
  const { data: ensName } = useWalletName(auth.signedIn ? address : undefined);
  if (auth.signedIn && address) {
    return <button onClick={openAccount} className="flex min-w-0 max-w-full items-center gap-2 rounded-full bg-soft py-1 pl-1 pr-4 font-semibold transition-colors hover:bg-[#ebe9f3]"
      title={ensName ? `${ensName} (${address})` : address}
      aria-label={`Wallet ${ensName ?? shortAddress(address)}, account options`}>
      <Avatar kind="person" palette={keyPalette(address)} size={32} />
      <span className={`max-w-[10rem] truncate text-sm sm:max-w-[16rem] ${ensName ? "" : "address"}`}>{ensName ?? shortAddress(address)}</span>
    </button>;
  }
  const waiting = auth.status === "connecting" || auth.status === "checking";
  return <Button size="sm" onClick={start} loading={waiting || auth.signing}>
    {!waiting && !auth.signing ? <Wallet /> : null}
    {auth.signing ? "Confirm in wallet" : waiting ? "Checking" : auth.status === "signed-out" ? "Sign in" : auth.status === "unavailable" ? "Retry" : "Connect wallet"}
  </Button>;
}

function NetworkBanner() {
  const { wrongNetwork, switchNetwork, switching } = useAccord();
  return <AnimatePresence>
    {wrongNetwork ? <motion.div role="status" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      className="sticky top-20 z-20 mx-auto mt-3 flex w-fit items-center gap-3 rounded-full bg-warn-soft py-1.5 pl-4 pr-1.5 text-sm font-medium text-warn shadow-float">
      <TriangleAlert size={16} /> Your wallet is on another network. Accord runs on Sepolia.
      <Button size="sm" onClick={() => void switchNetwork()} loading={switching}>Switch to Sepolia</Button>
    </motion.div> : null}
  </AnimatePresence>;
}

export function Footer() {
  return <footer className="mx-auto mt-24 flex w-full max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-6 pb-10 text-sm text-muted sm:px-8">
    <Logo className="text-lg text-ink" />
    <span>Built at ETHGlobal Tokyo 2026</span>
    <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-good" />Sepolia testnet</span>
    <Link href="/developers" className="font-medium hover:text-ink">Developers</Link>
    <Link href="/demo" className="font-medium hover:text-ink">Demo</Link>
    <span className="sm:ml-auto">Named with ENS. Authorized by people.</span>
  </footer>;
}
