import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Owner override 2026-07-17: self-hosted on the Hetzner VPS behind nginx (Cloudflare in front),
  // NOT Vercel. Standalone output = a self-contained node server for `node server.js`.
  // No /vpn or /mira-att rewrites needed: nginx on the box routes those paths before proxying
  // "/" to this app, so this app never receives them.
  output: "standalone",
  reactStrictMode: true,
  // Stop leaking `X-Powered-By: Next.js` on every response.
  poweredByHeader: false,
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.vualet.com" },
    ],
  },
  // Defense-in-depth duplicate of the security headers nginx/Cloudflare are
  // expected to set in front of this app — kept here so they still apply if
  // the app is ever fronted differently. Intentionally NO Content-Security-Policy:
  // a strict CSP would break inline scripts/styles this app currently relies on;
  // introducing one needs its own audit + report-only rollout, not a drive-by add.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
