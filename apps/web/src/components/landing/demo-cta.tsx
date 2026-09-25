"use client";

import Link from "next/link";
import { useAccord } from "@/lib/accord";
import { Button } from "../ui/button";

export function DemoCta({ footer = false }: { footer?: boolean }) {
  const { config } = useAccord();
  const address = config.data?.demoSpaceAddress;
  if (footer && !address) return null;
  return <Button asChild size="lg" variant={footer ? "primary" : "light"} className={footer ? "bg-white/10 shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.3)] hover:bg-white/15" : undefined}>
    <Link href={address ? `/spaces/${address}` : "#how"}>{address ? footer ? "Try the demo" : "Try the live demo" : "See how it works"}</Link>
  </Button>;
}
