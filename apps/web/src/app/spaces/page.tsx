import type { Metadata } from "next";
import { SpacesHome } from "@/components/home/spaces-home";

export const metadata: Metadata = { title: "Your Spaces · Accord" };

export default function SpacesPage() {
  return <SpacesHome />;
}
