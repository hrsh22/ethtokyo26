import type { NextConfig } from "next";

const localE2e = process.env.ACCORD_LOCAL_E2E === "1";
if (localE2e && (process.env.NODE_ENV !== "development" ||
  process.env.API_URL !== "http://127.0.0.1:4001" ||
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL !== "http://127.0.0.1:8546")) {
  throw new Error("Local E2E fixtures require development mode and the isolated local API/Anvil endpoints");
}

const nextConfig: NextConfig = {
  ...(localE2e ? { distDir: ".next-e2e", turbopack: { resolveAlias: {
    "@/components/world-session": "./test/world-session.tsx",
  } } } : {}),
  env: { NEXT_PUBLIC_ACCORD_LOCAL_E2E: localE2e ? "1" : "0" },
  allowedDevOrigins: ["127.0.0.1"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL ?? "http://localhost:4000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
