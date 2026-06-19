// Mira VPN checkout — NowPayments invoice (crypto + card, all-in-one).
// Customer picks their currency on the hosted page; we just set the USD price.
// Doc: https://documenter.getpostman.com/view/7907941/2s93JusNJt

import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = { email: string; plan: string };

const PRICE_USD = 9.99;
const NP_BASE = "https://api.nowpayments.io/v1";

export async function POST(req: Request) {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "nowpayments not configured" }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.email || !body.email.includes("@")) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  const origin = new URL(req.url).origin;

  const np = await fetch(`${NP_BASE}/invoice`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      price_amount: PRICE_USD,
      price_currency: "usd",
      order_id: body.email,                            // we identify the buyer by email
      order_description: "Mira VPN — monthly subscription",
      ipn_callback_url: `${origin}/api/webhooks/nowpayments`,
      success_url: `${origin}/vpn/checkout/success`,
      cancel_url: `${origin}/vpn/checkout`,
      is_fixed_rate: true,
      is_fee_paid_by_user: true,
    }),
  });

  if (!np.ok) {
    const text = await np.text();
    console.error("[nowpayments] invoice create failed", np.status, text);
    return NextResponse.json({ error: "nowpayments rejected" }, { status: 502 });
  }

  const { invoice_url } = (await np.json()) as { invoice_url: string };
  return NextResponse.json({ redirectUrl: invoice_url });
}
