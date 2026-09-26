"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccord } from "./accord";
import { paymentReview } from "./payment-review";

export function usePaymentReview(id?: string) {
  const { client, account, auth } = useAccord();
  return useQuery({
    queryKey: ["approval", id, account?.toLowerCase()],
    enabled: !!client && auth.signedIn && !!id,
    queryFn: () => client!.approval(id!),
    refetchOnWindowFocus: "always",
    refetchInterval: (query) => {
      const state = paymentReview(query.state.data?.status);
      return state.stopped || state.completed ? false : 3_000;
    },
    retry: 1,
  });
}
