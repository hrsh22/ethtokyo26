"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Fingerprint, ArrowUpRight } from "lucide-react";
import { useAccord } from "@/lib/accord";
import { Button } from "./ui/button";

export function PaymentReviewStatus({id}:{id:string}) {
  const {client,account}=useAccord();
  const query=useQuery({queryKey:["approval",id,account],enabled:!!client,queryFn:()=>client!.approval(id),refetchInterval:3000});
  const status=query.data?.status;
  const ready=status==="approved"||status==="issued"||status==="executed";
  const stopped=status && ["denied","cancelled","expired","invalidated"].includes(status);
  return <div role="status" className={`rounded-3xl p-5 ${stopped?"bg-bad-soft":ready?"bg-good-soft":"bg-[#eae2ff]"}`}>
    <div className="flex items-center gap-2 font-semibold"><Fingerprint size={18}/>{status==="executed"?"Payment completed":stopped?`Request ${status}`:ready?"Owner approved — ready to continue":"Waiting for owner approval"}</div>
    <p className="mt-2 text-sm text-ink-soft">{stopped?"This request cannot be used to pay.":ready?"Continue this payment. ENS authority and limits are checked again.":"The Space owner can review this request from their Spaces page."}</p>
    <Button asChild variant="light" size="sm" className="mt-3"><Link href={`/approvals/${id}`} target="_blank">View request<ArrowUpRight size={14}/></Link></Button>
  </div>;
}
