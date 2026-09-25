import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Accord — permissions for moving money",
  description: "Configure who can receive and spend from an Accord Space.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen">{process.env.NEXT_PUBLIC_ACCORD_LOCAL_E2E === "1" && <div role="status" style={{ padding: "12px 20px", background: "#ffe9a9", color: "#493100", textAlign: "center" }}>LOCAL E2E TEST · Anvil funds · World and Intercepta responses are simulated</div>}<AppProviders>{children}</AppProviders></body>
    </html>
  );
}

import { AppProviders } from "./providers";
