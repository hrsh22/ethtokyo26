"use client";

import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { useRef } from "react";

export function Modal({ open, onOpenChange, title, description, children, busy = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string;
  children: React.ReactNode; busy?: boolean;
}) {
  const content = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-backdrop" />
      <Dialog.Content ref={content} className="app-modal" onOpenAutoFocus={(event) => {
        if (document.activeElement instanceof HTMLElement && !content.current?.contains(document.activeElement)) returnFocus.current = document.activeElement;
        const field = content.current?.querySelector<HTMLElement>("[data-autofocus]");
        if (field) { event.preventDefault(); field.focus(); }
      }} onCloseAutoFocus={(event) => {
        if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); }
      }}>
        <Dialog.Title className="modal-title">{title}</Dialog.Title>
        <Dialog.Description className="modal-description">{description}</Dialog.Description>
        <Dialog.Close className="modal-close" aria-label="Close dialog" disabled={busy}><X size={20} /></Dialog.Close>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
