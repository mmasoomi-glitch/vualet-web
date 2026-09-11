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
          // HSTS is deliberately NOT set at the origin: Cloudflare fronts every
          // host and injects Strict-Transport-Security itself, and sending it
          // from both layers produced a duplicated header on every response.
          // If Cloudflare is ever removed, restore the origin header here.
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
              // The Cloudflare Web Analytics beacon is injected on every page and is the
              // one non-inline violation being logged. Allowlisted so the sink stays
              // readable and the inline-script violations stay visible.
              "script-src 'self' https://static.cloudflareinsights.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https:",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
              "form-action 'self'",
              // Violations now reach src/app/api/csp-report/route.ts instead of
              // only each visitor's console. BOTH directives are present on
              // purpose: report-uri is deprecated but is still what most
              // browsers honour, report-to is what newer ones use.
              "report-uri /api/csp-report",
              "report-to csp-endpoint",
            ].join("; "),
          },
          // ENFORCED policy, deliberately only four directives. These four generate
          // ZERO violations on any page today (measured live), they are what actually
          // stops clickjacking and form hijacking, and they cost nothing.
          //
          // DO NOT ADD default-src HERE, and do not "complete" this list with
          // script-src or style-src. This header is enforced independently of the
          // report-only one above, so a default-src would apply to scripts and styles
          // by fallback and start BLOCKING them - and the pages carry inline scripts
          // with no nonce, so the first thing to break would be hydration on the
          // checkout. The full policy stays report-only until a per-request nonce
          // exists, which was considered and deliberately rejected: it would force
          // dynamic rendering across a mostly-static marketing site to defend against
          // an injection vector this site does not have.
          {
            key: "Content-Security-Policy",
            value: [
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
              "form-action 'self'",
            ].join("; "),
          },
          { key: "Reporting-Endpoints", value: 'csp-endpoint="/api/csp-report"' },
        ],
      },
    ];
  },
};

export default nextConfig;
