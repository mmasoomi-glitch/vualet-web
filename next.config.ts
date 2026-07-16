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
  // Jury #32: mira.vualet.com moves to Vercel, but /vpn and /mira-att are LIVE services on the
  // Hetzner box. Proxy those paths back to a stable Hetzner origin so they keep working after the
  // DNS cutover. HETZNER_ORIGIN must resolve to the Hetzner box (89.167.49.209) with its own cert
  // (e.g. edge.vualet.com) and nginx serving /vpn + /mira-att for that host.
  async rewrites() {
    const origin = process.env.HETZNER_ORIGIN || "https://edge.vualet.com";
    return [
      { source: "/vpn", destination: `${origin}/vpn` },
      { source: "/vpn/:path*", destination: `${origin}/vpn/:path*` },
      { source: "/mira-att", destination: `${origin}/mira-att` },
      { source: "/mira-att/:path*", destination: `${origin}/mira-att/:path*` },
    ];
  },
};

export default nextConfig;
