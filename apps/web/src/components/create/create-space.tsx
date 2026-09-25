"use client";

import { spaceFactoryAbi } from "@accord/chain";
import type { AccordClient } from "@accord/sdk";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Check, ChevronDown, Coins, Rocket } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { erc20Abi, getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { SEPOLIA_CHAIN_ID, useAccord } from "@/lib/accord";
import { activationHash, activationStorageKey, readActivation, saveActivation } from "@/lib/activation-storage";
import { describeError, tagOf } from "@/lib/errors";
import { shortAddress } from "@/lib/format";
import { keyPalette } from "@/lib/palette";
import { useChainActions } from "@/lib/use-chain-actions";
import { SignInCard } from "../sign-in-card";
import { DemoTokenFaucet } from "../demo-token-faucet";
import { TxTracker, useSteps } from "../tx-tracker";
import { Button } from "../ui/button";

type Draft = Awaited<ReturnType<AccordClient["listSpaces"]>>["spaces"][number];
const suggestions = ["Family support", "Research budget", "Team stipends", "Community grants"];
const deploySteps = [
  { id: "save", label: "Save your Space" },
  { id: "wallet", label: "Approve the deployment" },
  { id: "chain", label: "Deploy on Sepolia" },
  { id: "link", label: "Finish setup" },
];

export function CreateSpace() {
  const { auth, client, config, account, checkSession } = useAccord();
  const params = useSearchParams();
  // Only the draft in the URL on arrival is resumed; the wizard adds ?draft= itself once it saves one.
  const [draftId] = useState(() => params.get("draft"));
  const spaces = useQuery({ queryKey: ["spaces", account?.toLowerCase()], queryFn: () => client!.listSpaces(), enabled: !!client && auth.signedIn && !!draftId, retry: false });
  const existing = draftId ? spaces.data?.spaces.find((space) => space.id === draftId) : undefined;
  const router = useRouter();
  useEffect(() => { if (existing?.spaceAddress) router.replace(`/spaces/${existing.spaceAddress}`); }, [existing, router]);
  useEffect(() => { if (spaces.error) checkSession(spaces.error); }, [spaces.error, checkSession]);

  if (!auth.signedIn) return <Frame><SignInCard title="Sign in to create a Space" body="Your Space is owned by the wallet you sign in with. Signing in is free." /></Frame>;
  if (draftId && spaces.isPending) return <Frame><div className="h-80 animate-pulse rounded-tile bg-white/70" /></Frame>;
  if (config.isPending) return <Frame><div className="h-80 animate-pulse rounded-tile bg-white/70" /></Frame>;
  const deployment = config.data;
  if (!deployment?.configured || !deployment.factoryAddress || !deployment.adapterAddress || !deployment.authorizerAddress) {
    return <Frame><div role="alert" className="card p-8">
      <h2 className="font-display text-3xl font-extrabold">Setup isn’t available right now</h2>
      <p className="mt-2 text-ink-soft">This Accord deployment has no Space factory configured. Try again later.</p>
      <Button variant="soft" className="mt-5" onClick={() => void config.refetch()} loading={config.isFetching}>Try again</Button>
    </div></Frame>;
  }
  return <Frame><Wizard key={existing?.id ?? "new"} existing={existing?.spaceAddress ? undefined : existing} deployment={{
    factory: getAddress(deployment.factoryAddress), adapter: getAddress(deployment.adapterAddress),
    authorizer: getAddress(deployment.authorizerAddress), demoToken: deployment.demoTokenAddress ? getAddress(deployment.demoTokenAddress) : undefined,
  }} /></Frame>;
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[680px]">
    <Link href="/spaces" className="mb-6 inline-flex items-center gap-2 font-semibold text-muted hover:text-ink"><ArrowLeft size={18} />Your Spaces</Link>
    {children}
  </div>;
}

function Wizard({ existing, deployment }: { existing?: Draft; deployment: { factory: Address; adapter: Address; authorizer: Address; demoToken?: Address } }) {
  const { client, account, checkSession } = useAccord();
  const router = useRouter();
  const cache = useQueryClient();
  const chain = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const { requireWallet } = useChainActions();
  const [step, setStep] = useState<"name" | "asset" | "deploy">(existing ? "deploy" : "name");
  const [name, setName] = useState(existing?.name ?? "");
  const [draft, setDraft] = useState<Draft | undefined>(existing);
  const [choice, setChoice] = useState<"demo" | "custom">(deployment.demoToken ? "demo" : "custom");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const initial = useMemo(() => deploySteps, []);
  const tracker = useSteps(initial);
  const storageKey = draft ? activationStorageKey(account!, draft.id) : null;
  const pending = useQuery({ queryKey: ["pending-activation", storageKey], enabled: !!storageKey, staleTime: Infinity, retry: false,
    queryFn: () => { try { return readActivation(window.localStorage, storageKey!); } catch { return null; } } });

  const tokenInput = (choice === "demo" ? deployment.demoToken ?? "" : custom).trim();
  const token = isAddress(tokenInput) && tokenInput !== zeroAddress ? getAddress(tokenInput) : undefined;
  const asset = useQuery({
    queryKey: ["activation-asset", token], enabled: !!token && !!chain, retry: false, staleTime: 60_000,
    queryFn: async () => {
      const [decimals, symbol] = await Promise.all([
        chain!.readContract({ address: token!, abi: erc20Abi, functionName: "decimals" }),
        chain!.readContract({ address: token!, abi: erc20Abi, functionName: "symbol" }).catch(() => "Token"),
        chain!.readContract({ address: token!, abi: erc20Abi, functionName: "balanceOf", args: [zeroAddress] }),
      ]);
      return { decimals, symbol: symbol.trim() || "Token" };
    },
  });

  function remember(hash: Hex | null) {
    if (!storageKey) return;
    cache.setQueryData(["pending-activation", storageKey], hash);
    try { if (!saveActivation(window.localStorage, storageKey, hash)) toast.warning("Browser storage is off. Keep this tab open until setup finishes."); }
    catch { toast.warning("Browser storage is off. Keep this tab open until setup finishes."); }
  }

  async function finish(current: Draft, hash: Hex) {
    tracker.update("wallet", { state: "done", hash });
    await tracker.run("chain", "Waiting for the block", async () => {
      const receipt = await requireWallet().waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (receipt.status !== "success") { remember(null); throw Object.assign(new Error("The deployment reverted. You can try again."), { reverted: true }); }
    });
    const activated = await tracker.run("link", "Saving it to your account", () => client!.activateSpace({ draftId: current.id, deploymentTx: hash }));
    remember(null);
    await cache.invalidateQueries({ queryKey: ["spaces"] });
    toast.success(`${activated.name} is live`, { description: "Now give a person an allowance or an agent a budget." });
    router.push(`/spaces/${activated.spaceAddress}`);
  }

  function explain(cause: unknown, submitted: boolean) {
    checkSession(cause);
    const tag = tagOf(cause);
    if (cause instanceof Error && "reverted" in cause) return cause.message;
    if (tag === "Unauthorized") return "Your session expired. Sign in again, then finish setup. No new transaction or fee is needed.";
    if (tag === "BadRequest" || tag === "Forbidden") return "That transaction couldn't be linked to this Space. Check it created a Space from this wallet, then try again.";
    if (submitted) return "The deployment was sent, but setup didn't finish. Use Finish setup to retry without paying again.";
    return describeError(cause, "Setup didn't finish.");
  }

  async function deploy() {
    if (busy || !token || !asset.isSuccess) return;
    setBusy(true); setError(null);
    let submitted = false;
    try {
      requireWallet();
      let current = draft;
      if (!current) {
        current = await tracker.run("save", "Creating your Space record", () => client!.createDraft({ name: name.trim(), templateId: "recurring-support" }));
        setDraft(current);
        router.replace(`/spaces/new?draft=${current.id}`, { scroll: false });
        await cache.invalidateQueries({ queryKey: ["spaces"] });
      } else tracker.update("save", { state: "done" });
      const hash = await tracker.run("wallet", "Confirm in your wallet", () => writeContractAsync({
        address: deployment.factory, abi: spaceFactoryAbi, functionName: "createSpace",
        args: [deployment.authorizer, token, deployment.adapter], chainId: SEPOLIA_CHAIN_ID,
      }));
      submitted = true;
      const key = activationStorageKey(account!, current.id);
      cache.setQueryData(["pending-activation", key], hash);
      try { saveActivation(window.localStorage, key, hash); } catch { /* warned in remember() on retry */ }
      await finish(current, hash);
    } catch (cause) {
      setError(explain(cause, submitted));
    } finally { setBusy(false); }
  }

  async function resume(hash: Hex) {
    if (busy || !draft) return;
    setBusy(true); setError(null);
    tracker.update("save", { state: "done" });
    remember(hash);
    try { requireWallet(); await finish(draft, hash); }
    catch (cause) { setError(explain(cause, true)); }
    finally { setBusy(false); }
  }

  const palette = keyPalette(name || "space");
  const nameValid = name.trim().length >= 2 && name.trim().length <= 80;
  const order = ["name", "asset", "deploy"] as const;

  return <section className="card overflow-hidden" aria-labelledby="create-title">
    <div className="relative overflow-hidden px-7 pb-7 pt-8 sm:px-9" style={{ background: palette.tile, color: palette.ink }}>
      <div className="flex gap-2">{order.map((item, index) => <span key={item} className={`pill ${step === item ? "bg-ink text-white" : order.indexOf(step) > index ? "bg-white/80" : "bg-white/40"}`}>
        {order.indexOf(step) > index ? <Check size={14} strokeWidth={3} /> : null}{["Name", "Asset", "Deploy"][index]}
      </span>)}</div>
      <h1 id="create-title" className="mt-6 font-display text-[44px] font-extrabold leading-none tracking-[-0.03em]">{name.trim() || "New Space"}</h1>
      <p className="mt-2 opacity-75">{step === "name" ? "What's this Space for?" : step === "asset" ? "Pick the token it will hold." : "One transaction and it's live."}</p>
    </div>
    <div className="p-7 sm:p-9">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }}>
          {step === "name" ? <form onSubmit={(event) => { event.preventDefault(); if (nameValid) setStep("asset"); }}>
            <label htmlFor="space-name" className="font-semibold">Space name</label>
            <input id="space-name" className="field mt-2 text-lg" autoFocus maxLength={80} value={name} placeholder="e.g. Research budget"
              onChange={(event) => setName(event.target.value)} />
            <div className="mt-3 flex flex-wrap gap-2">{suggestions.map((item) => <button type="button" key={item} onClick={() => setName(item)}
              className="rounded-full bg-soft px-4 py-2 text-sm font-semibold transition-colors hover:bg-[#ebe9f3]">{item}</button>)}</div>
            <p className="mt-4 text-sm text-muted">You can hold both people and agents in the same Space. Anyone with a link to it sees this name.</p>
            <div className="mt-7 flex justify-end"><Button type="submit" size="lg" disabled={!nameValid}>Continue</Button></div>
          </form> : step === "asset" ? <div>
            <fieldset>
              <legend className="font-semibold">Token</legend>
              {deployment.demoToken ? <label className={`mt-3 flex cursor-pointer items-center gap-4 rounded-3xl p-4 transition-shadow ${choice === "demo" ? "bg-lime-soft shadow-[inset_0_0_0_2px_#8bc51f]" : "bg-soft"}`}>
                <input type="radio" name="asset" className="sr-only" checked={choice === "demo"} onChange={() => setChoice("demo")} />
                <span className="grid size-12 place-items-center rounded-2xl bg-lime text-[#243300]"><Coins /></span>
                <span className="flex-1"><b className="block">ACD demo token</b><span className="text-sm text-muted">Free test tokens for trying Accord. No real value.</span></span>
                {choice === "demo" ? <Check className="text-good" /> : null}
              </label> : null}
              <details className="group mt-3 rounded-3xl bg-soft p-4" open={!deployment.demoToken || choice === "custom"}>
                <summary className="flex cursor-pointer list-none items-center justify-between font-semibold">Use another ERC-20 token<ChevronDown size={18} className="transition-transform group-open:rotate-180" /></summary>
                <label htmlFor="custom-token" className="mt-3 block text-sm text-muted">Token contract on Sepolia</label>
                <input id="custom-token" className="field mt-1" placeholder="0x…" value={custom} autoComplete="off" spellCheck={false}
                  onFocus={() => setChoice("custom")} onChange={(event) => { setChoice("custom"); setCustom(event.target.value); }}
                  aria-invalid={choice === "custom" && !!custom && !token} />
              </details>
            </fieldset>
            {choice === "demo" && deployment.demoToken ? <div className="mt-5"><DemoTokenFaucet inline /></div> : null}
            <p role="status" className="mt-4 min-h-6 text-sm font-medium">
              {choice === "custom" && custom && !token ? <span className="text-bad">That isn’t a valid token address.</span>
                : token && asset.isFetching ? <span className="text-muted">Checking the token on Sepolia…</span>
                : token && asset.isError ? <span className="text-bad">Couldn’t read this token on Sepolia. Check the address.</span>
                : token && asset.data ? <span className="text-good">{asset.data.symbol} at {shortAddress(token)}. This can’t change later.</span> : null}
            </p>
            <div className="mt-6 flex justify-between"><Button variant="ghost" onClick={() => setStep("name")}>Back</Button><Button size="lg" disabled={!token || !asset.isSuccess} onClick={() => setStep("deploy")}>Continue</Button></div>
          </div> : <div>
            {pending.data && !busy ? <div className="mb-5 rounded-3xl bg-sky-soft p-5">
              <b className="block">You already sent the deployment</b>
              <p className="mt-1 text-sm text-ink-soft">Finish setup without paying again. Transaction <span className="address">{shortAddress(pending.data)}</span>.</p>
              <Button className="mt-4" onClick={() => void resume(pending.data!)}>Finish setup</Button>
            </div> : null}
            <TxTracker steps={tracker.steps} />
            {error ? <p role="alert" className="mt-4 rounded-2xl bg-bad-soft px-4 py-3 text-sm font-medium text-bad">{error}</p> : null}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <Button variant="ghost" disabled={busy} onClick={() => setStep("asset")}>Back</Button>
              {!pending.data ? <Button size="lg" onClick={() => void deploy()} loading={busy} disabled={!token || !asset.isSuccess}><Rocket />{draft ? "Deploy Space" : "Create Space"}</Button> : null}
            </div>
            <p className="mt-4 text-sm text-muted">The network fee is paid in Sepolia ETH. The Space is owned by {account ? shortAddress(account) : "your wallet"}.</p>
            {draft ? <details className="mt-5 text-sm" open={recoverOpen} onToggle={(event) => setRecoverOpen(event.currentTarget.open)}>
              <summary className="cursor-pointer font-semibold text-muted">Already deployed from another tab?</summary>
              <form className="mt-3 flex gap-2" onSubmit={(event) => {
                event.preventDefault();
                const hash = String(new FormData(event.currentTarget).get("hash") ?? "").trim();
                if (!activationHash.test(hash)) { setError("Paste the full transaction hash from your wallet's activity."); return; }
                void resume(hash as Hex);
              }}>
                <label htmlFor="recover-hash" className="sr-only">Deployment transaction hash</label>
                <input id="recover-hash" name="hash" className="field" placeholder="0x… transaction hash" autoComplete="off" spellCheck={false} disabled={busy} />
                <Button type="submit" variant="soft" className="h-[50px]" disabled={busy}>Recover</Button>
              </form>
            </details> : null}
          </div>}
        </motion.div>
      </AnimatePresence>
    </div>
  </section>;
}
