import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Hosted on Vercel (native Next.js runtime) — no standalone/Docker output needed.
  reactStrictMode: true,
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.vualet.com" },
    ],
  },
};

export default nextConfig;
