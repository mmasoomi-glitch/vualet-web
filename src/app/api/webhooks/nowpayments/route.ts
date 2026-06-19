// NowPayments IPN (Instant Payment Notification) receiver.
// Doc: https://documenter.getpostman.com/view/7907941/2s93JusNJt
//
// NowPayments signs the JSON body with HMAC-SHA512 using the IPN_SECRET and
// sends the signature in the `x-nowpayments-sig` header. We must verify it
// against the RAW body (same pattern as the Dodo webhook in this repo).
//
// On a confirmed payment we issue a Mira VPN permit and send it to the buyer's
// email. The permit-issuance HMAC + delivery live in a separate backend
// service (the Mira VPN backend on Hetzner); this route hands off via a
// signed internal call.

import crypto from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type IpnPayload = {
  payment_id: number;
  payment_status:
    | "waiting"
    | "confirming"
    | "confirmed"
    | "sending"
    | "partially_paid"
    | "finished"
    | "failed"
    | "refunded"
    | "expired";
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  pay_currency: string;
  order_id?: string;          // we set this to the buyer's email or a UUID
  order_description?: string;
  outcome_amount?: number;
  outcome_currency?: string;
  purchase_id?: string;
};

function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  // NowPayments requires the JSON to be sorted by keys, then HMAC-SHA512.
  // For verification we use the raw body bytes as received — the server has
  // already canonicalised them.
  const expected = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  // Constant-time compare
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(header, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret) {
    // Misconfigured — fail loudly server-side, not silently 200 OK
    return NextResponse.json({ error: "ipn secret missing" }, { status: 500 });
  }

  const rawBody = await req.text();
  const sig = req.headers.get("x-nowpayments-sig");

  if (!verifySignature(rawBody, sig, secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let payload: IpnPayload;
  try {
    payload = JSON.parse(rawBody) as IpnPayload;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // Only act on terminal-positive states. NowPayments may send `confirming`
  // first, then `finished` — we only issue the permit on `finished`.
  if (payload.payment_status !== "finished") {
    return NextResponse.json({ ok: true, noted: payload.payment_status });
  }

  // TODO: call the Mira VPN backend permit-issuance endpoint
  // (on the Hetzner box, e.g. https://api.mira.vualet.com/internal/issue-permit)
  // signed with an internal shared secret. For now log and return.
  console.info("[nowpayments] payment finished", {
    payment_id: payload.payment_id,
    order_id: payload.order_id,
    pay_currency: payload.pay_currency,
    outcome_amount: payload.outcome_amount,
  });

  return NextResponse.json({ ok: true });
}

// GET is rejected — NowPayments only ever POSTs the IPN.
export async function GET() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405 });
}
