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
  // the app is ever fronted differently. CSP rollout (jury verdict #83, 2026-07-27):
  // ship the strict policy in REPORT-ONLY first (it never blocks) so we observe what
  // Next.js's inline hydration scripts trigger, before enforcing it with per-request
  // nonces via middleware. style-src keeps 'unsafe-inline' as the tracked exception
  // until the inline-style refactor lands.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Scope powerful features: microphone stays enabled for same-origin
          // (MiraBot voice input) — this matches the spec default allowlist, so it
          // does not restrict the app itself — while unused features are disabled.
          { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=(self), payment=(), usb=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https:",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
