import { NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";
import { getConnect, putConnect, putSubscription, type ConnectRecord } from "@/lib/store";

// Dodo posts subscription/payment lifecycle events here (Standard Webhooks spec).
// Configure this URL + DODO_WEBHOOK_SECRET in the Dodo dashboard.
export async function POST(req: Request) {
  const secret = process.env.DODO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[dodo-webhook] missing DODO_WEBHOOK_SECRET");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const raw = await req.text();
  const headers = {
    "webhook-id": req.headers.get("webhook-id") ?? "",
    "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": req.headers.get("webhook-signature") ?? "",
  };

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = new Webhook(secret).verify(raw, headers) as typeof event;
  } catch (err) {
    console.error("[dodo-webhook] bad signature:", err);
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const type = event.type ?? "";
  const data = event.data ?? {};
  const metadata = (data.metadata as Record<string, string> | undefined) ?? {};
  const token = metadata.connect_token;
  const customerId =
    (data.customer_id as string | undefined) ||
    ((data.customer as { customer_id?: string } | undefined)?.customer_id);
  const subscriptionId = (data.subscription_id as string | undefined) || (data.id as string | undefined);

  try {
    switch (type) {
      case "subscription.active":
      case "subscription.renewed":
      case "payment.succeeded": {
        const base: ConnectRecord | null = token ? await getConnect(token) : null;
        const rec: ConnectRecord = {
          token: token ?? subscriptionId ?? customerId ?? "unknown",
          plan: base?.plan ?? metadata.plan ?? "companion",
          email: base?.email ?? (data.customer as { email?: string } | undefined)?.email,
          status: "active",
          customerId,
          subscriptionId,
          telegramId: base?.telegramId,
          createdAt: base?.createdAt ?? new Date().toISOString(),
        };
        if (token) await putConnect(rec);
        if (customerId) await putSubscription(customerId, rec);
        console.log(`[dodo-webhook] ${type} → active`, { customerId, plan: rec.plan });
        break;
      }
      case "subscription.cancelled":
      case "subscription.on_hold":
      case "subscription.expired": {
        if (customerId) {
          const rec = (await import("@/lib/store")).getSubscription;
          const existing = await rec(customerId);
          if (existing) {
            existing.status = "cancelled";
            await putSubscription(customerId, existing);
            if (existing.token) await putConnect(existing);
          }
        }
        console.log(`[dodo-webhook] ${type} → cancelled`, { customerId });
        break;
      }
      default:
        console.log(`[dodo-webhook] ignored: ${type}`);
    }
  } catch (err) {
    console.error("[dodo-webhook] handler error:", err);
    return NextResponse.json({ error: "handler_error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
