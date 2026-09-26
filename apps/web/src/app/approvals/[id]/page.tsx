import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ApprovalReview } from "@/components/approval-review";

export const metadata: Metadata = { title: "Review request · Accord" };

export default async function ApprovalPage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
  return <Suspense fallback={<div className="card p-8">Loading request…</div>}><ApprovalReview id={id}/></Suspense>;
}
