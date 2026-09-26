import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConnectAgent } from "@/components/connect-agent";

export const metadata: Metadata = { title: "Connect your agent · Accord" };

export default async function ConnectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  return <ConnectAgent id={id}/>;
}
