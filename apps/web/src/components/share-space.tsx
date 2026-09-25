"use client";
import { useState } from "react";
import { Button } from "./ui/button";
export function ShareSpace({ address, showOpenLink = true }: { address: string; showOpenLink?: boolean }) {
  const [message, setMessage] = useState<string>();
  const path = `/spaces/${address}`;
  return <div className="share-space">{showOpenLink ? <a href={path}>Open shareable page</a> : null}<Button variant="outline" onClick={async () => {
    try { await navigator.clipboard.writeText(new URL(path, window.location.origin).href); setMessage("Space link copied. This link grants no spending rights."); }
    catch { setMessage("Open the shareable page and copy its address from your browser."); }
  }}>Copy Space link</Button>{message ? <small role="status">{message}</small> : null}</div>;
}
