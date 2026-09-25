"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { createAccordClient, type AccordClient } from "@accord/sdk";
import { useAppKit, useAppKitState } from "@reown/appkit/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ArrowUpRight, Bot, Check, ChevronDown, FolderOpen, Link2, Plus, UsersRound, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSwitchChain } from "wagmi";
import { getAddress, isAddress } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { AuthAction } from "@/components/auth-action";
import { useWalletSession } from "@/lib/use-wallet-session";
import { isUnauthorized } from "@/lib/auth-state";

const SpaceConsole = dynamic(() => import("@/components/space-console").then((module) => module.SpaceConsole), {
  loading: () => <div className="workspace-placeholder" role="status">Loading Space…</div>,
});
const SharedSpacePreview = dynamic(() => import("@/components/shared-space-preview").then((module) => module.SharedSpacePreview));
type TemplateId = "recurring-support" | "research-budget";
type SpaceDraft = Awaited<ReturnType<AccordClient["listSpaces"]>>["spaces"][number];
const patterns = [
  { id: "recurring-support" as const, name: "For a person", description: "Recurring support with a verified recipient.", icon: UsersRound },
  { id: "research-budget" as const, name: "For an agent", description: "A spending budget with clear limits.", icon: Bot },
];
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const demoAddress = process.env.NEXT_PUBLIC_DEMO_SPACE_ADDRESS;

export default function Home({ sharedAddress }: { sharedAddress?: `0x${string}` }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { open } = useAppKit();
  const { open: walletModalOpen } = useAppKitState();
  const { switchChainAsync } = useSwitchChain();
  const clientQuery = useQuery({ queryKey: ["accord-client"], queryFn: () => createAccordClient("/api"), staleTime: Infinity });
  const client = clientQuery.data;
  const auth = useWalletSession(client);
  const { connection, signedIn } = auth;
  const [draftOpen, setDraftOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>("recurring-support");
  const [draftName, setDraftName] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [sharedInput, setSharedInput] = useState("");
  const [openError, setOpenError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ account: string; draft: SpaceDraft } | null>(null);
  const accountKey = connection.address?.toLowerCase();
  const wrongNetwork = !!connection.address && connection.chainId !== undefined && connection.chainId !== 11155111;
  const spaces = useQuery({ queryKey: ["spaces", accountKey], queryFn: () => client!.listSpaces(),
    enabled: !!client && signedIn && !sharedAddress, retry: false });
  const shared = useQuery({ queryKey: ["shared-draft", sharedAddress, accountKey],
    queryFn: () => client!.lookupSpace(sharedAddress!), enabled: !!client && signedIn && !!sharedAddress, retry: false });
  const activeSpace = signedIn ? (opened && opened.account === accountKey ? opened.draft : shared.data) : undefined;
  const draftMessage = draftError === "session-expired" ? (signedIn ? null : "Your session expired. Sign in below; your draft is still here.") : draftError;
  const privateDataError = spaces.error ?? shared.error;
  const { expire } = auth;
  useEffect(() => { if (isUnauthorized(privateDataError)) expire(); }, [privateDataError, expire]);

  function connectWallet() {
    if (!process.env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim()) {
      setNotice("Wallet connection is temporarily unavailable. Please try again later."); return;
    }
    auth.clearError(); setNotice(null);
    void open({ view: "Connect" });
  }
  function startDraft() { setDraftOpen(true); setDraftError(null); auth.clearError(); }
  function selectSpace(draft: SpaceDraft) {
    setOpened({ account: accountKey!, draft }); setNotice(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function createDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !signedIn || busy) return;
    const name = draftName.trim();
    if (name.length < 2 || name.length > 80) { setDraftError("Use a name between 2 and 80 characters."); return; }
    setBusy(true); setDraftError(null);
    try {
      const created = await client.createDraft({ name, templateId: selectedTemplate });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
      setDraftOpen(false); setDraftName(""); selectSpace(created);
      setNotice("Draft saved. Activate it when you’re ready to add funds.");
    } catch (error) {
      if (isUnauthorized(error)) { auth.expire(); setDraftError("session-expired"); }
      else setDraftError("We couldn’t save this draft. Your details are kept here—try again.");
    } finally { setBusy(false); }
  }
  async function openSpace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = sharedInput.trim();
    if (!isAddress(address)) { setOpenError("Enter a valid Space address starting with 0x."); return; }
    // Shared pages can be read without signing in; permitted actions are gated there.
    setOpenDialog(false);
    router.push(`/spaces/${getAddress(address)}`);
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Accord home"><span className="brand-mark"><span /></span><span>accord<span className="brand-dot">.</span></span></Link>
      <nav className="header-links" aria-label="Primary"><Link href="/" aria-current={!sharedAddress ? "page" : undefined}>My Spaces</Link>{demoAddress && isAddress(demoAddress) ? <Link href={`/spaces/${demoAddress}`}>Explore demo <ArrowUpRight size={14} /></Link> : null}</nav>
      <div className="header-action">
        {connection.address ? <><span className="header-session"><AuthAction auth={auth} connect={connectWallet} compact /></span><Button variant="outline" className="wallet-button" onClick={() => void open({ view: "Account" })} aria-label={`Wallet ${shortAddress(connection.address)} — account options`}><Wallet size={15} />{shortAddress(connection.address)}</Button></> : <AuthAction auth={auth} connect={connectWallet} compact />}
      </div>
    </header>
    <main id="main" className="workspace-main">
      {wrongNetwork ? <div className="network-notice page-container" role="status"><span>Your wallet is on another network. Space transactions use Sepolia.</span><Button variant="outline" onClick={async () => {
        try { await switchChainAsync({ chainId: 11155111 }); }
        catch { setNotice("Network switch was not completed. Choose Sepolia in your wallet and retry."); }
      }}>Switch to Sepolia</Button></div> : null}
      {notice ? <div className="workspace-notice page-container" role="status"><span>{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={16} /></button></div> : null}
      {sharedAddress && !activeSpace ? <><SharedSpacePreview address={sharedAddress} account={connection.address} client={client} /><div className="shared-entry page-container">{!signedIn ? <AuthAction auth={auth} connect={connectWallet} /> : shared.isPending ? <p role="status">Checking available actions…</p> : shared.isError ? <p role="status">This Space isn’t registered with this Accord deployment. You can still review its public terms above.</p> : null}</div></> : null}
      {activeSpace && signedIn && client && connection.address ? <section className="space-detail page-container" id="space-console">
        <Link href="/" className="back-link" onClick={(event) => { if (!sharedAddress) { event.preventDefault(); setOpened(null); setNotice(null); } }}><ArrowLeft size={16} />All Spaces</Link>
        <SpaceConsole key={`${activeSpace.id}:${accountKey}`} account={connection.address} draft={activeSpace} client={client} onDraftUpdated={(draft) => {
          setOpened({ account: accountKey!, draft }); setNotice(null); void queryClient.invalidateQueries({ queryKey: ["spaces"] });
        }} />
      </section> : !sharedAddress ? <section className="workspace page-container" id="workspace" aria-labelledby="workspace-title">
        <div className="workspace-heading"><div><h1 id="workspace-title">Your Spaces</h1><p>Set who can use funds, and under which conditions.</p></div><div className="workspace-actions"><Button variant="outline" onClick={() => { setOpenDialog(true); setOpenError(null); }}><Link2 size={16} />Open shared Space</Button><Button onClick={startDraft}><Plus size={16} />New Space</Button></div></div>
        {!signedIn ? <div className="workspace-welcome"><div className="welcome-copy"><FolderOpen size={28} strokeWidth={1.5} /><h2>One place for your agreements.</h2><p>Reserve funds for someone you support, or give an agent a budget. You decide the limits.</p><AuthAction auth={auth} connect={connectWallet} /></div><div className="welcome-patterns">{patterns.map(({ id, name, description, icon: Icon }) => <button key={id} onClick={() => { setSelectedTemplate(id); startDraft(); }}><Icon size={22} strokeWidth={1.6} /><span><strong>{name}</strong><small>{description}</small></span><ArrowRight size={17} /></button>)}</div></div> : spaces.isPending ? <div className="workspace-placeholder" role="status">Loading your Spaces…</div> : spaces.isError ? <div className="workspace-placeholder" role="alert"><h2>We couldn’t load your Spaces.</h2><p>Your saved drafts are safe. Try the connection again.</p><Button variant="outline" onClick={() => void spaces.refetch()}>Try again</Button></div> : spaces.data?.spaces.length ? <div className="space-list">
          <div className="space-list-heading"><span>Name</span><span>Status</span></div>
          {spaces.data.spaces.map((space) => <button type="button" className="space-row" key={space.id} onClick={() => selectSpace(space)} aria-label={`Open ${space.name}`}><span className="space-row-icon">{space.templateId === "recurring-support" ? <UsersRound size={20} /> : <Bot size={20} />}</span><span className="space-row-name"><strong>{space.name}</strong><small>{space.templateId === "recurring-support" ? "People" : "Agents"} · Created {new Date(space.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></span><span className={`draft-pill${space.spaceAddress ? " draft-pill--active" : ""}`}>{space.spaceAddress ? "Active" : "Draft"}</span><ArrowRight size={16} /></button>)}
        </div> : <div className="workspace-empty"><FolderOpen size={32} strokeWidth={1.4} /><h2>Create your first Space</h2><p>Start with a person or an agent. Saving a draft is free.</p><Button onClick={startDraft}><Plus size={16} />New Space</Button></div>}
        <details className="workspace-help"><summary>How does a Space work?<ChevronDown size={16} /></summary><div className="help-steps"><div><strong>Create an agreement</strong><p>Name your Space and choose who it’s for. Save a draft at no cost.</p></div><div><strong>Add funds and limits</strong><p>Activate on Sepolia, then reserve tokens and define who can access them.</p></div><div><strong>Verify each action</strong><p>People verify with World ID. Agent payments follow their mandate and screening rules.</p></div></div></details>
      </section> : null}
    </main>
    <footer className="site-footer page-container"><span>Accord · Conditional access to shared funds</span><span className="network-label"><span />Sepolia testnet</span>{demoAddress && isAddress(demoAddress) ? <Link href={`/spaces/${demoAddress}`}>View demo <ArrowUpRight size={13} /></Link> : null}</footer>
    <Modal open={draftOpen && !walletModalOpen} onOpenChange={setDraftOpen} busy={busy || auth.signing} title="Create a Space" description="Choose a starting point. You can add people and agents later.">
      <form onSubmit={createDraft} className="draft-form">
        <fieldset className="pattern-picker" disabled={busy}><legend>Who is this for?</legend>{patterns.map(({ id, name, icon: Icon }) => <label key={id} className={selectedTemplate === id ? "is-selected" : ""}><input type="radio" name="template" value={id} checked={selectedTemplate === id} onChange={() => setSelectedTemplate(id)} /><Icon size={19} /><span>{name}</span>{selectedTemplate === id ? <Check size={15} /> : null}</label>)}</fieldset>
        <div className="form-field"><Label htmlFor="space-name">Space name</Label><Input id="space-name" data-autofocus disabled={busy} value={draftName} onChange={(event) => { setDraftName(event.target.value); setDraftError(null); }} placeholder={selectedTemplate === "recurring-support" ? "e.g. Family support" : "e.g. Research budget"} minLength={2} maxLength={80} required aria-invalid={!!draftMessage} aria-describedby={draftMessage ? "draft-error" : "draft-description"} /><p id="draft-description" className="field-help">A draft is free. You’ll choose the asset and limits next.</p></div>
        {draftMessage ? <p id="draft-error" className="form-error" role="alert">{draftMessage}</p> : null}
        {!signedIn ? <div className="modal-auth"><AuthAction auth={auth} connect={connectWallet} /></div> : <div className="modal-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => setDraftOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Create draft"}<ArrowRight size={16} /></Button></div>}
      </form>
    </Modal>
    <Modal open={openDialog} onOpenChange={setOpenDialog} title="Open a shared Space" description="Paste a Space address to review its terms. Only permitted wallets can act.">
      <form onSubmit={openSpace} className="draft-form"><div className="form-field"><Label htmlFor="shared-address">Space address</Label><Input id="shared-address" data-autofocus value={sharedInput} onChange={(event) => { setSharedInput(event.target.value); setOpenError(null); }} placeholder="0x…" required aria-invalid={!!openError} />{openError ? <p className="form-error" role="alert">{openError}</p> : null}</div><div className="modal-actions"><Button type="submit">Open Space<ArrowRight size={16} /></Button></div></form>
    </Modal>
  </div>;
}
