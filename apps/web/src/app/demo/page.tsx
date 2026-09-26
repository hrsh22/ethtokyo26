import type { Metadata } from "next";
import { DemoOverview } from "@/components/demo-overview";

export const metadata: Metadata = { title: "See Accord in action — Accord", description: "Inspect a real agent purchase, an owner denial and ENS revocation on Sepolia." };
export default function DemoPage() { return <DemoOverview />; }
