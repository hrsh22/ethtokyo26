"use client";

import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Link2, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Sheet } from "./ui/sheet";

/** Share a Space or allocation link. The link shows terms; only the named wallet can act. */
export function ShareButton({ path, title, description, variant = "light", label = "Share" }: {
  path: string; title: string; description: string; variant?: "light" | "soft" | "primary" | "onColor"; label?: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant={variant} onClick={() => setOpen(true)}><Share2 />{label}</Button>
    <Sheet open={open} onOpenChange={setOpen} title={title} description={description}><SharePanel path={path} /></Sheet>
  </>;
}

export function SharePanel({ path }: { path: string }) {
  // Only rendered after client-side data loads, so window is available.
  const url = typeof window === "undefined" ? path : new URL(path, window.location.origin).href;
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); toast.success("Link copied"); setTimeout(() => setCopied(false), 1800); }
    catch { toast.error("Couldn't copy. Select the link and copy it yourself."); }
  }
  return <div className="grid min-w-0 grid-cols-1 gap-5">
    <div className="mx-auto rounded-[1.75rem] bg-soft p-5"><QRCodeSVG value={url} size={180} bgColor="transparent" fgColor="#16122b" level="M" /></div>
    <div className="flex items-center gap-2 rounded-2xl bg-soft p-2 pl-4">
      <Link2 size={16} className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={url}>{url}</span>
      <Button size="sm" onClick={() => void copy()}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</Button>
    </div>
    {typeof navigator !== "undefined" && "share" in navigator ? <Button variant="soft" onClick={() => void navigator.share({ url }).catch(() => undefined)}><Share2 />Share with…</Button> : null}
    <p className="text-center text-sm text-muted">Anyone with the link can see the rules. Only the named wallet can claim or pay.</p>
  </div>;
}
