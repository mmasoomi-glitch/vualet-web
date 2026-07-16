import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Owner override 2026-07-17: self-hosted on the Hetzner VPS behind nginx (Cloudflare in front),
  // NOT Vercel. Standalone output = a self-contained node server for `node server.js`.
  // No /vpn or /mira-att rewrites needed: nginx on the box routes those paths before proxying
  // "/" to this app, so this app never receives them.
  output: "standalone",
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
