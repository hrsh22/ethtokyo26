"use client";

import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef } from "react";

/** Centred dialog that rises in. Keeps focus handling from Radix; blocks closing while busy. */
export function Sheet({ open, onOpenChange, title, description, children, busy = false, wide = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string;
  children: React.ReactNode; busy?: boolean; wide?: boolean;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <AnimatePresence>
      {open ? <Dialog.Portal forceMount>
        <Dialog.Overlay asChild forceMount>
          <motion.div className="fixed inset-0 z-40 bg-canvas/60 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        </Dialog.Overlay>
        <Dialog.Content asChild forceMount onOpenAutoFocus={(event) => {
          if (document.activeElement instanceof HTMLElement) returnFocus.current = document.activeElement;
          const field = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[data-autofocus]");
          if (field) { event.preventDefault(); field.focus(); }
        }} onCloseAutoFocus={(event) => {
          if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); }
        }}>
          <motion.div className="fixed left-1/2 top-1/2 z-50 max-h-[92dvh] overflow-y-auto rounded-[2.25rem] bg-white p-7 shadow-pop sm:p-8"
            style={{ width: `min(94vw, ${wide ? 680 : 520}px)` }}
            initial={{ opacity: 0, y: "-44%", x: "-50%", scale: 0.96 }} animate={{ opacity: 1, y: "-50%", x: "-50%", scale: 1 }}
            exit={{ opacity: 0, y: "-46%", x: "-50%", scale: 0.97 }} transition={{ type: "spring", stiffness: 380, damping: 32 }}>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="font-display text-[28px] font-extrabold leading-tight">{title}</Dialog.Title>
                {description ? <Dialog.Description className="mt-1 text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
              </div>
              <Dialog.Close className="grid size-10 shrink-0 place-items-center rounded-full bg-soft text-ink-soft hover:bg-[#ebe9f3] disabled:opacity-40" aria-label="Close" disabled={busy}><X size={18} /></Dialog.Close>
            </div>
            {children}
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal> : null}
    </AnimatePresence>
  </Dialog.Root>;
}
