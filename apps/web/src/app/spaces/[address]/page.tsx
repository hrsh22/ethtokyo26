import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { SpaceScreen } from "@/components/space/space-screen";

export default async function SpacePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  return <SpaceScreen address={getAddress(address)} />;
}
