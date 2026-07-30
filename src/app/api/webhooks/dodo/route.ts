import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  getConnect,
  putConnect,
  putSubscription,
  getSubscription,
  kvGet,
  kvSet,
  type ConnectRecord,
} from "@/lib/store";
import {
  wasEventProcessed as coreWasEventProcessed,
  markEventProcessed as coreMarkEventProcessed,
} from "@/lib/webhook-core.mjs";
import { verifyDodoWebhook, activateDodo } from "@/lib/dodo-webhook-core.mjs";

// Dodo posts subscription/payment lifecycle events here (Standard Webhooks).
// Configure this URL + DODO_WEBHOOK_SECRET in the Dodo dashboard.
// Signature is verified against the RAW body; crypto needs the Node runtime.
export const runtime = "nodejs";

// Reuse the SAME durable idempotency namespace/helpers as the Stripe webhook so
// a redelivered Dodo event.id is processed exactly once.
async function wasEventProcessed(id: string): Promise<boolean> {
  return coreWasEventProcessed(kvGet, id);
}
async function markEventProcessed(id: string): Promise<void> {
  await coreMarkEventProcessed(kvSet, id);
}

// timing-safe string compare for the base64 signatures.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

async function cancelFromDodo(payload: { subscription_id?: string; customer?: { customer_id?: string }; customer_id?: string }): Promise<void> {
  const customerId = payload?.customer?.customer_id ?? payload?.customer_id;
  if (!customerId) return;
  const existing = await getSubscription(customerId);
  if (existing) {
    existing.status = "cancelled";
    await putSubscription(customerId, existing);
    if (existing.token) await putConnect(existing);
  }
  console.log("[dodo-webhook] cancelled", { customerId });
}

export async function POST(req: Request) {
  const secret = process.env.DODO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[dodo-webhook] missing DODO_WEBHOOK_SECRET");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const raw = await req.text();
  const id = req.headers.get("webhook-id") ?? "";
  const timestamp = req.headers.get("webhook-timestamp") ?? "";
  const signatureHeader = req.headers.get("webhook-signature") ?? "";

  const verdict = verifyDodoWebhook(
    { id, timestamp, signatureHeader, rawBody: raw, secret },
    { createHmac: crypto.createHmac, Buffer, safeEqual },
  );
  if (!verdict.ok) {
    console.error("[dodo-webhook] verify failed:", verdict.reason);
    return NextResponse.json({ error: "invalid_signature", reason: verdict.reason }, { status: 400 });
  }

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const type = event.type ?? "";
  const data = (event.data ?? {}) as Record<string, unknown>;

  // Idempotency on the Standard-Webhooks id.
  try {
    if (await wasEventProcessed(id)) {
      console.log("[dodo-webhook] duplicate ignored:", id, type);
      return NextResponse.json({ received: true, duplicate: true });
    }
  } catch (err) {
    console.warn("[dodo-webhook] idempotency check failed, processing anyway:", err);
  }

  try {
    switch (type) {
      // Initial purchase + renewals both activate the tier the server chose.
      case "subscription.active":
      case "subscription.renewed":
      case "payment.succeeded": {
        const rec: ConnectRecord = await activateDodo(data, {
          getConnect,
          putConnect,
          putSubscription,
        });
        console.log(`[dodo-webhook] ${type} → active`, { customerId: rec.customerId, plan: rec.plan });
        break;
      }
      case "subscription.cancelled":
      case "subscription.canceled":
      case "subscription.expired":
      case "subscription.failed":
        await cancelFromDodo(data as { subscription_id?: string; customer?: { customer_id?: string }; customer_id?: string });
        break;
      default:
        console.log(`[dodo-webhook] ignored: ${type}`);
    }
  } catch (err) {
    // 500 WITHOUT marking processed so Dodo retries.
    console.error("[dodo-webhook] handler error:", err);
    return NextResponse.json({ error: "handler_error" }, { status: 500 });
  }

  try {
    await markEventProcessed(id);
  } catch (err) {
    console.warn("[dodo-webhook] could not persist idempotency marker:", err);
  }

  return NextResponse.json({ received: true });
}
