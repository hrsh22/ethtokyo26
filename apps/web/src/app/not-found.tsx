import Link from "next/link";
import { AppNav, Footer } from "@/components/app-nav";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { allocationPalette } from "@/lib/palette";

export default function NotFound() {
  return <div className="flex min-h-dvh flex-col">
    <AppNav />
    <main id="main" className="mx-auto grid w-full max-w-xl flex-1 place-content-center px-6 text-center">
      <Avatar kind="agent" palette={allocationPalette(BigInt(2), true)} size={88} className="mx-auto" />
      <h1 className="mt-8 font-display text-5xl font-extrabold tracking-tight">Nothing here</h1>
      <p className="mt-3 text-lg text-ink-soft">That link doesn’t point to a Space or allocation. Check it was copied in full.</p>
      <div className="mt-8 flex justify-center gap-2">
        <Button asChild variant="light"><Link href="/">Home</Link></Button>
        <Button asChild><Link href="/spaces">Your Spaces</Link></Button>
      </div>
    </main>
    <Footer />
  </div>;
}
