// Card checkout via Dodo Payments — Mira VPN monthly subscription.
//
// This mirrors the existing /api/checkout flow in this repo (Dodo Standard
// Webhooks). The actual Dodo checkout link generation already exists at
// /api/checkout; we forward to it with the VPN product id.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = { email: string; plan: string };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.email || !body.email.includes("@")) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  // Reuse the existing Dodo checkout-link endpoint. The product slug must be
  // registered in Dodo as `mira-vpn-monthly` ($9.99/mo). When that exists,
  // this returns a hosted Dodo URL.
  const origin = new URL(req.url).origin;
  const r = await fetch(`${origin}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productSlug: "mira-vpn", email: body.email, plan: body.plan }),
  });

  if (!r.ok) {
    const text = await r.text();
    console.error("[card checkout] /api/checkout rejected", r.status, text);
    return NextResponse.json({ error: "checkout unavailable" }, { status: 502 });
  }
  const { redirectUrl } = (await r.json()) as { redirectUrl: string };
  return NextResponse.json({ redirectUrl });
}
