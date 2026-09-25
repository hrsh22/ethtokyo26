"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseAccordLink } from "@/lib/links";
import { Button } from "./ui/button";

export function OpenLinkForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return <form onSubmit={(event) => {
    event.preventDefault();
    const path = parseAccordLink(value);
    if (!path) { setError("Paste a Space link or an address that starts with 0x."); return; }
    router.push(path);
  }}>
    <div className="flex flex-col gap-2 sm:flex-row">
      <label htmlFor="open-link" className="sr-only">Space link or address</label>
      <input id="open-link" className="field" placeholder="Paste a link or 0x… address" value={value} data-autofocus={autoFocus || undefined}
        onChange={(event) => { setValue(event.target.value); setError(null); }} aria-invalid={!!error} aria-describedby={error ? "open-link-error" : undefined}
        autoComplete="off" spellCheck={false} />
      <Button type="submit" variant="soft" className="h-[50px]">Open</Button>
    </div>
    {error ? <p id="open-link-error" role="alert" className="mt-2 text-sm font-medium text-bad">{error}</p> : null}
  </form>;
}
