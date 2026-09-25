import type { Metadata } from "next";
import { Suspense } from "react";
import { CreateSpace } from "@/components/create/create-space";

export const metadata: Metadata = { title: "New Space · Accord" };

export default function NewSpacePage() {
  return <Suspense><CreateSpace /></Suspense>;
}
