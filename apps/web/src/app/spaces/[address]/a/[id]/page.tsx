import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { AllocationScreen } from "@/components/allocation/allocation-screen";

export default async function AllocationPage({ params }: { params: Promise<{ address: string; id: string }> }) {
  const { address, id } = await params;
  if (!isAddress(address) || !/^[1-9][0-9]{0,77}$/.test(id)) notFound();
  return <AllocationScreen address={getAddress(address)} id={BigInt(id)} />;
}
