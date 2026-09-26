"use client";

import Link from "next/link";
import { Button } from "../ui/button";

export function DemoCta({ footer = false }: { footer?: boolean }) {
  return <Button asChild size="lg" variant={footer ? "primary" : "light"} className={footer ? "bg-white/10 shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.3)] hover:bg-white/15" : undefined}>
    <Link href="/demo">See Accord in action</Link>
  </Button>;
}
