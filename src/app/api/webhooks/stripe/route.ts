import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, planForPriceId } from "@/lib/stripe";
import {
  getConnect,
  putConnect,
  putSubscription,
  getSubscription,
  kvGet,
  kvSet,
  type ConnectRecord,
} from "@/lib/store";

// Stripe posts subscription/payment lifecycle events here.
// Configure this URL + STRIPE_WEBHOOK_SECRET in the Stripe dashboard.
// Signature is verified against the RAW body; crypto needs the Node runtime.
export const runtime = "nodejs";

// Durable idempotency: dedupe on event.id using the store's generic kv helpers.
// The `mira:evt:` namespace can never collide with connect tokens (`mira:connect:`)
// or subscription records (`mira:sub:`). TTL comfortably outlives Stripe's retry
// window (Stripe retries for up to ~3 days).
const EVENT_TTL_SECONDS = 60 * 60 * 24 * 4;
const eventKey = (id: string) => `mira:evt:${id}`;

async function wasEventProcessed(id: string): Promise<boolean> {
  return (await kvGet<number>(eventKey(id))) != null;
}
async function markEventProcessed(id: string): Promise<void> {
  await kvSet(eventKey(id), Date.now(), EVENT_TTL_SECONDS);
}

// Stripe fields are `id | expanded object | null`; normalise to the id string.
function idOf(v: string | { id?: string } | null | undefined): string | undefined {
  if (!v) return undefined;
  return typeof v === "string" ? v : v.id;
}

// Statuses that mean "no longer a paying subscriber" → mirror dodo's cancel branch.
const CANCEL_STATUSES = new Set([
  "canceled",
  "unpaid",
  "past_due",
  "incomplete_expired",
]);

// The invoice→subscription link has moved across Stripe API versions
// (top-level `subscription`, then `parent.subscription_details`, then on line
// items). Read it defensively so we don't couple to one shape.
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | undefined {
  const inv = invoice as unknown as {
    subscription?: string | { id?: string } | null;
    parent?: {
      subscription_details?: { subscription?: string | { id?: string } | null } | null;
    } | null;
    lines?: { data?: Array<{ subscription?: string | { id?: string } | null }> };
  };
  return (
    idOf(inv.subscription) ??
    idOf(inv.parent?.subscription_details?.subscription) ??
    idOf(inv.lines?.data?.[0]?.subscription)
  );
}

// ---- side effects (mirror src/app/api/webhooks/dodo/route.ts) -------------

// Initial purchase: session carries the connect_token we set at checkout.
async function activateFromCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const token = session.metadata?.connect_token || undefined;
  const customerId = idOf(session.customer);
  const subscriptionId = idOf(session.subscription);
  const base: ConnectRecord | null = token ? await getConnect(token) : null;

  const rec: ConnectRecord = {
    token: token ?? subscriptionId ?? customerId ?? "unknown",
    plan: base?.plan ?? session.metadata?.plan ?? "companion",
    email: base?.email ?? session.customer_details?.email ?? undefined,
    status: "active",
    customerId,
    subscriptionId,
    telegramId: base?.telegramId,
    persona: base?.persona,
    role: base?.role,
    assistantName: base?.assistantName,
    createdAt: base?.createdAt ?? new Date().toISOString(),
  };
  if (token) await putConnect(rec);
  if (customerId) await putSubscription(customerId, rec);
  console.log("[stripe-webhook] checkout.session.completed → active", {
    customerId,
    plan: rec.plan,
  });
}

// Renewal: invoice.paid. The connect_token lives on the subscription's metadata
// (set at checkout) or on the already-stored subscription record.
async function refreshFromInvoice(invoice: Stripe.Invoice): Promise<void> {
  const customerId = idOf(invoice.customer);
  const subscriptionId = invoiceSubscriptionId(invoice);

  let base: ConnectRecord | null = customerId ? await getSubscription(customerId) : null;
  let token = base?.token;

  // No stored record yet (e.g. store scaled out) → recover token from Stripe.
  if (!token && subscriptionId) {
    try {
      const sub = await stripe().subscriptions.retrieve(subscriptionId);
      token = sub.metadata?.connect_token || token;
      if (token) base = (await getConnect(token)) ?? base;
    } catch (err) {
      console.warn("[stripe-webhook] could not retrieve subscription for renewal", err);
    }
  }

  // Hardening (jury #36): if neither the stored record nor a Stripe re-fetch
  // yielded a token, we cannot trust the plan — do NOT fabricate an "active
  // companion" record from a guess. There's no user to bind without a token, so
  // ack and move on. (A transient store failure throws above → 500 → Stripe
  // retries; this branch is only the genuinely-unrecoverable case.)
  if (!token && !base) {
    console.error("[stripe-webhook] invoice.paid: no token/record recoverable — skipping", {
      customerId,
      subscriptionId,
    });
    return;
  }

  const rec: ConnectRecord = {
    token: token ?? base?.token ?? subscriptionId ?? customerId ?? "unknown",
    plan: base?.plan ?? "companion",
    email: base?.email,
    status: "active",
    customerId: customerId ?? base?.customerId,
    subscriptionId: subscriptionId ?? base?.subscriptionId,
    telegramId: base?.telegramId,
    persona: base?.persona,
    role: base?.role,
    assistantName: base?.assistantName,
    createdAt: base?.createdAt ?? new Date().toISOString(),
  };
  if (token) await putConnect(rec);
  if (rec.customerId) await putSubscription(rec.customerId, rec);
  console.log("[stripe-webhook] invoice.paid → active", {
    customerId: rec.customerId,
    plan: rec.plan,
  });
}

// Upgrade / downgrade: an active customer.subscription.updated whose price no longer matches
// the stored plan. jury #67: the purchased tier must stay correct end-to-end, so when Stripe
// reports a new price we rewrite the stored connect + subscription record's `plan`. The engine
// reads this plan on its next bind (telegram-bot bindFromConnectToken → entitlementForPlan), so
// the new tier propagates without a manual edit. Idempotent: a no-op when the plan is unchanged
// or the price is unknown (we never guess a plan). Does NOT touch status — that stays whatever
// the active/cancel branches set.
async function changePlanFromSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = idOf(sub.customer);
  if (!customerId) return;
  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const newPlan = planForPriceId(priceId);
  if (!newPlan) {
    console.log("[stripe-webhook] subscription.updated: price not mapped to a plan — skipping", { customerId, priceId });
    return;
  }
  const existing = await getSubscription(customerId);
  if (!existing) {
    console.log("[stripe-webhook] subscription.updated: no stored record yet — skipping plan sync", { customerId });
    return;
  }
  if (existing.plan === newPlan) return; // idempotent no-op
  const prev = existing.plan;
  existing.plan = newPlan;
  await putSubscription(customerId, existing);
  if (existing.token) await putConnect(existing);
  console.log("[stripe-webhook] subscription.updated → plan changed", { customerId, from: prev, to: newPlan });
}

// Cancel / lapse: flip the stored record to "cancelled" — identical to dodo.
async function cancelFromSubscription(sub: Stripe.Subscription, type: string): Promise<void> {
  const customerId = idOf(sub.customer);
  if (customerId) {
    const existing = await getSubscription(customerId);
    if (existing) {
      existing.status = "cancelled";
      await putSubscription(customerId, existing);
      if (existing.token) await putConnect(existing);
    }
  }
  console.log(`[stripe-webhook] ${type} (status=${sub.status}) → cancelled`, { customerId });
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe-webhook] missing STRIPE_WEBHOOK_SECRET");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const raw = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("[stripe-webhook] bad signature:", err);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  // Idempotency: never process the same delivered event twice.
  try {
    if (await wasEventProcessed(event.id)) {
      console.log("[stripe-webhook] duplicate ignored:", event.id, event.type);
      return NextResponse.json({ received: true, duplicate: true });
    }
  } catch (err) {
    // A store read failure must not drop the event — fall through and process.
    console.warn("[stripe-webhook] idempotency check failed, processing anyway:", err);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await activateFromCheckout(event.data.object as Stripe.Checkout.Session);
        break;
      case "invoice.paid":
      case "invoice.payment_succeeded":
        await refreshFromInvoice(event.data.object as Stripe.Invoice);
        break;
      case "customer.subscription.deleted":
        await cancelFromSubscription(event.data.object as Stripe.Subscription, event.type);
        break;
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        if (CANCEL_STATUSES.has(sub.status)) {
          await cancelFromSubscription(sub, event.type);
        } else {
          // Active (or trialing) update — the interesting case is a plan upgrade/downgrade.
          await changePlanFromSubscription(sub);
        }
        break;
      }
      default:
        console.log(`[stripe-webhook] ignored: ${event.type}`);
    }
  } catch (err) {
    // Return 500 WITHOUT marking processed so Stripe retries the delivery.
    console.error("[stripe-webhook] handler error:", err);
    return NextResponse.json({ error: "handler_error" }, { status: 500 });
  }

  // Mark only after successful handling so a failed attempt is retried, not lost.
  try {
    await markEventProcessed(event.id);
  } catch (err) {
    console.warn("[stripe-webhook] could not persist idempotency marker:", err);
  }

  return NextResponse.json({ received: true });
}
