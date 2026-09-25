import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAddress, isAddress } from "viem";
import { NewAllocation } from "@/components/allocate/new-allocation";

export default async function NewAllocationPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  return <Suspense><NewAllocation address={getAddress(address)} /></Suspense>;
}
