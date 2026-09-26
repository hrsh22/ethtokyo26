"use client";

import Link from "next/link";
import type { ApprovalRequest } from "@accord/sdk";
import { Fingerprint, ArrowUpRight } from "lucide-react";
import { paymentReview } from "@/lib/payment-review";
import { usePaymentReview } from "@/lib/use-payment-review";
import { Button } from "./ui/button";

export function PaymentReviewStatus({id}:{id:string}) {
  const query=usePaymentReview(id);
  return <PaymentReviewState id={id} request={query.data} error={query.isError} />;
}

export function PaymentReviewState({id,request,error=false}:{id:string;request?:ApprovalRequest;error?:boolean}) {
  const status=request?.status;
  const {ready,completed,stopped}=paymentReview(status);
  return <div role="status" className={`rounded-3xl p-5 ${stopped?"bg-bad-soft":ready||completed?"bg-good-soft":"bg-[#eae2ff]"}`}>
    <div className="flex items-center gap-2 font-semibold"><Fingerprint size={18}/>{error?"Couldn’t refresh approval":completed?"Payment completed":stopped?`Request ${status}`:ready?"Owner approved - ready to continue":!status?"Checking owner approval…":"Waiting for owner approval"}</div>
    <p className="mt-2 text-sm text-ink-soft">{error?"Reconnecting to the approval service. Your request is saved.":completed?"The payment has been confirmed.":stopped?"This request cannot be used to pay.":ready?"Continue this payment. ENS authority and limits are checked again.":"This updates automatically when the owner decides."}</p>
    <Button asChild variant="light" size="sm" className="mt-3"><Link href={`/approvals/${id}`} target="_blank">View request<ArrowUpRight size={14}/></Link></Button>
  </div>;
}
