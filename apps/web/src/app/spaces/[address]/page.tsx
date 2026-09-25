import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import Home from "../../home";
export default async function SharedSpacePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  return <Home sharedAddress={getAddress(address)} />;
}
