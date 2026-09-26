import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AppProviders } from "./providers";

const general = localFont({
  variable: "--font-general",
  display: "swap",
  src: [
    { path: "./fonts/GeneralSans-Regular.woff2", weight: "400" },
    { path: "./fonts/GeneralSans-Medium.woff2", weight: "500" },
    { path: "./fonts/GeneralSans-Semibold.woff2", weight: "600" },
  ],
});
const cabinet = localFont({
  variable: "--font-cabinet",
  display: "swap",
  src: [
    { path: "./fonts/CabinetGrotesk-Medium.woff2", weight: "500" },
    { path: "./fonts/CabinetGrotesk-Bold.woff2", weight: "700" },
    { path: "./fonts/CabinetGrotesk-Extrabold.woff2", weight: "800" },
  ],
});

export const metadata: Metadata = {
  title: "Accord - allowances for humans and their AI agents",
  description: "Give people and agents a budget with rules the contract enforces. People claim with World ID; agents spend under an ENS-bound mandate.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${general.variable} ${cabinet.variable}`}>
      <body className="min-h-dvh">
        {process.env.NEXT_PUBLIC_ACCORD_LOCAL_E2E === "1" && <div role="status" className="bg-[#ffe9a9] px-5 py-3 text-center text-sm font-semibold text-[#493100]">LOCAL E2E TEST · Anvil funds · World and Intercepta responses are simulated</div>}
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
