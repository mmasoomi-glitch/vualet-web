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
import {
  verifyDodoWebhook,
  activateDodo,
  applyDodoLifecycle,
  dodoEventEffect,
  dodoEventIsMiraOwned,
} from "@/lib/dodo-webhook-core.mjs";
import { planForProductId } from "@/lib/dodo";
// THE PUSH HALF OF decisions#342 Q_B. Until this import existed, every handler
// below rewrote a KV blob the engine never reads at revocation time
// (gotchas#262): a refunded customer kept their paid tier and their token
// credits in the assistant forever.
import {
  engineEventForEffect,
  engineEventAtIso,
  pushEntitlementToEngine,
} from "@/lib/engine-push";

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

/**
 * DISPUTE AND REFUND EVENTS NAME NO HUMAN (ledger gotchas#262). A dispute
 * payload carries `dispute_id`, `payment_id` and `amount` — no subscription id
 * and no customer id — so there is literally nothing in it to look a record up
 * by. This is the hop that fixes that: `GET /payments/{payment_id}` returns the
 * payment, which DOES carry `customer.customer_id` and `subscription_id`.
 *
 * It lives here rather than in dodo-webhook-core.mjs because it needs the
 * network and an API key, and that module is deliberately env-free and
 * dependency-injected so its tests exercise the real code with no provider. It
 * also lives here rather than in src/lib/dodo.ts because this writer does not
 * own that file; `dodoBaseUrl()` is not exported from it, so the two-line mode
 * switch is repeated below. That duplication is a known, deliberate cost and is
 * the one thing in this change worth folding back into dodo.ts later.
 *
 * NEVER THROWS. A failure here must degrade to "we could not identify the
 * customer", which the core answers with a loud alert and NO state change —
 * never with an exception, because an exception on this path becomes a Dodo
 * retry loop rather than an alert anybody reads.
 */
async function resolvePaymentIdentity(
  paymentId: string,
): Promise<{ customerId?: string; subscriptionId?: string } | null> {
  const apiKey = process.env.DODO_API_KEY;
  if (!apiKey) {
    console.error(
      "[dodo-webhook] cannot resolve payment " + paymentId + " -> customer: DODO_API_KEY is unset. " +
        "A dispute or refund arriving now will be logged and will change NOTHING.",
    );
    return null;
  }
  const base =
    process.env.DODO_MODE === "live"
      ? "https://live.dodopayments.com"
      : "https://test.dodopayments.com";
  try {
    const res = await fetch(`${base}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.error(`[dodo-webhook] GET /payments/${paymentId} failed ${res.status}; identity unresolved`);
      return null;
    }
    const json = (await res.json()) as {
      customer?: { customer_id?: string };
      customer_id?: string;
      subscription_id?: string;
    };
    return {
      customerId: json?.customer?.customer_id ?? json?.customer_id,
      subscriptionId: json?.subscription_id,
    };
  } catch (err) {
    console.error(`[dodo-webhook] GET /payments/${paymentId} threw; identity unresolved:`, err);
    return null;
  }
}

/**
 * PUSH THE ACCESS CHANGE TO THE ENGINE — the wire that makes revocation real
 * (gotchas#262, decisions#342 Q_B).
 *
 * Everything above this line only ever changed a record in OUR store. The
 * assistant the customer actually talks to lives in another deployment and, at
 * revocation time, never read it: setTenantStatus/setTenantEntitlement had
 * exactly one production call site, at bind time. So a refund revoked a row and
 * nothing else — the customer kept their paid tier and their credits.
 *
 * THIS IS THE OPTIMISATION, NOT THE CORRECTNESS LAYER, and the whole shape of
 * this function follows from that. The engine re-resolves entitlement on every
 * message (15s cache) and runs a reconciliation sweep, so a push that fails
 * costs the customer a slower revocation, never a wrong one. Therefore:
 *
 *   - IT NEVER THROWS. A throw here reaches the caller's try/catch, returns 500
 *     and makes Dodo redeliver the same refund forever. Same contract
 *     applyDodoLifecycle holds, for the same reason.
 *   - IT NEVER RETRIES. The convergence layer is the retry.
 *   - IT ONLY EVER RUNS AFTER the local write succeeded, so the web record and
 *     the engine can never disagree in the direction that grants access.
 *
 * WHAT IS AND IS NOT PUSHED. engineEventForEffect() reads the SAME
 * DODO_EVENT_EFFECTS row the handler acted on, so there is no second event list
 * here to drift: revoke and restore rows push, flag/log/reprice rows do not.
 * Restores push too, and that is not a nicety — dispute.won, dunning.recovered
 * and subscription.unpaused all mean access comes BACK, and a one-way revoke is
 * a new defect. Two outcomes are deliberately NOT pushed:
 *   - `restore_refused`, where the core refused to lift a status this event has
 *     no authority over. Pushing it would contradict our own record and hand
 *     access back to, say, a refunded customer on a late dunning.recovered.
 *   - anything with `ok: false` (unresolved customer, no local record), which
 *     has already alerted loudly and changed nothing.
 * A REPLAY IS PUSHED. `changed: false` on a revoke means we already held that
 * status — and the engine push is convergent, so re-pushing is exactly the
 * repair path for a delivery whose push failed the first time.
 *
 * IDENTITY: TELEGRAM ID, ESTABLISHED FROM THE STORE, NEVER INVENTED. The engine
 * accepts `tenantId` or `telegramId`; this app has no concept of a tenantId at
 * all — no field on any record, no env var, nothing writes one — so
 * `telegramId` is the only key it can honestly present.
 *
 * AND IT IS NOT SIMPLY SITTING ON THE RECORD, which is the part worth reading
 * twice. In the ordinary order of events — pay, then run /start — the DURABLE
 * subscription record never carries a telegramId at all: activation writes it
 * from a connect record that is not yet bound, and claimConnect (store.ts) then
 * writes the bind onto the CONNECT record only. So the id lives on the connect
 * record, under a 7-day TTL... and applyDodoLifecycle mirrors the freshly
 * revoked subscription record straight over that connect key moments before we
 * could read it. Looking afterwards therefore finds nothing, and every push for
 * the most common signup order would have been skipped "for lack of identity"
 * while looking entirely correct.
 *
 * Hence three sources, in order: the subscription record; the id RESCUED from
 * the connect record immediately before the mirror overwrote it (see the
 * putConnect wrapper in POST); and finally a plain read of the connect record,
 * which is what answers on a replay where no mirror write happened. When none
 * of the three holds one, the push is SKIPPED with a loud log and no fabricated
 * id: an unbound record usually means the customer never ran /start, so there
 * is no engine tenant to revoke, and a guessed identifier could only ever
 * revoke a stranger.
 */
async function pushLifecycleToEngine(
  type: string,
  effect: { kind?: string; status?: string },
  outcome: { ok: boolean; action: string; customerId?: string; changed?: boolean },
  provenance: { eventId: string; eventAt?: string; telegramId?: number },
): Promise<void> {
  try {
    const engineEvent = engineEventForEffect(effect);
    if (!engineEvent) return; // flag / log: nothing the customer can feel
    if (!outcome.ok) return; // already alerted; nothing was changed here either
    if (outcome.action !== "revoke" && outcome.action !== "restore" && outcome.action !== "reprice") return;
    if (!outcome.customerId) return;

    const rec = await getSubscription(outcome.customerId);
    let telegramId =
      typeof rec?.telegramId === "number"
        ? rec.telegramId
        : typeof provenance.telegramId === "number"
          ? provenance.telegramId
          : undefined;
    if (telegramId === undefined && rec?.token) {
      const connect = await getConnect(rec.token);
      if (typeof connect?.telegramId === "number") telegramId = connect.telegramId;
    }
    if (telegramId === undefined) {
      console.error(
        `[dodo-webhook] ${type} for ${outcome.customerId}: the local record is now ` +
          `"${rec?.status ?? "unknown"}" but it carries NO telegramId, on the subscription record ` +
          "or on the connect record, so there is no identity to push to the engine and NOTHING was " +
          "pushed. Normal when the customer never bound the assistant (no /start), in which case " +
          "there is no engine tenant to revoke. If this customer IS using the assistant, the " +
          "engine's reconciliation sweep is now the only thing that will revoke them — investigate.",
      );
      return;
    }

    const result = await pushEntitlementToEngine({
      telegramId,
      event: engineEvent,
      // Restores carry the plan so the engine can put the tier back exactly
      // where it was; a restore without one leaves tier/credits untouched.
      // Reprices ALWAYS carry it - the record was re-read after the lifecycle
      // wrote the new plan, so rec.plan is the tier actually paid for, and a
      // tier-shaped push without a plan would be refused by the engine.
      plan: outcome.action === "restore" || outcome.action === "reprice" ? rec?.plan : undefined,
      eventId: provenance.eventId,
      eventAt: provenance.eventAt,
      context: type,
    });
    if (result.pushed) {
      console.log(`[dodo-webhook] ${type} → engine push applied as ${engineEvent}`);
    }
  } catch (err) {
    // Belt and braces: pushEntitlementToEngine already swallows everything, and
    // the store reads above are the only other throw sites. A webhook must not
    // 500 because a revocation was merely SLOW to propagate.
    console.error(
      `[dodo-webhook] ${type}: engine push path failed before it could send. The local record is ` +
        "correct and the engine will converge through its re-resolve and reconciliation sweep:",
      err,
    );
  }
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

  // `timestamp` is read for the engine push: it is the PROVIDER'S emission
  // time, which is what orders state on the engine side. See engineEventAtIso.
  let event: { type?: string; data?: Record<string, unknown>; timestamp?: unknown };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const type = event.type ?? "";
  const data = (event.data ?? {}) as Record<string, unknown>;
  // PROVENANCE FOR THE ENGINE PUSH, both values straight from Dodo and neither
  // one our own clock. `id` is the Standard-Webhooks event id already used for
  // idempotency here; `eventAt` is the provider's emission time, which the
  // engine orders by so a late-arriving dunning.recovered cannot resurrect a
  // cancelled customer. The header is guaranteed present on anything that got
  // past the signature check above, because the signature covers it.
  const eventAt = engineEventAtIso(event.timestamp, timestamp);

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
        // A second product now shares this Dodo merchant account, and Dodo
        // fans every event out to every endpoint, signing each with that
        // endpoint's own secret - so a valid signature proves the sender is
        // Dodo, not that the event is ours. Without this guard a foreign
        // purchase would mint an active Mira subscription and, on a colliding
        // customer email, attach it to a real Mira user. This guards the
        // GRANT path only. It breaks rather than returns so the handler tail
        // still runs: the event is marked processed and answered HTTP 200 -
        // an early return would skip the idempotency marker and make Dodo
        // retry a foreign event forever.
        const ownership = dodoEventIsMiraOwned(data, { planForProductId });
        if (!ownership.owned) {
          console.log(`[dodo-webhook] ${type} → foreign.ignored`, { productId: ownership.productId ?? "none", reason: ownership.reason });
          break;
        }
        const rec: ConnectRecord = await activateDodo(data, {
          getConnect,
          // RENEWAL RECOVERY (gotchas#258): this case handles renewals, not just
          // the first purchase, and by renewal time the connect record has
          // expired (7-day TTL). Without this the durable subscription record is
          // the only place the binding fields still live — and it was being
          // overwritten from an empty base, wiping them a month after purchase.
          getSubscription,
          putConnect,
          putSubscription,
          // THE TIER AUTHORITY (decisions#341 Q3), and the line that makes
          // writer J's resolver ladder actually run. Without it the ladder
          // silently degrades to rung 2 — the plan this server happens to have
          // recorded — which absorbs nearly every case, so the "FIX THE PRODUCT
          // MAPPING URGENTLY" alert the ruling exists to produce would never
          // have fired in production and nobody would have known the mapping
          // was wrong. The resolver names itself `resolver=NOT WIRED` in its own
          // alert text precisely so this omission could not hide.
          planForProductId,
        });
        console.log(`[dodo-webhook] ${type} → active`, { customerId: rec.customerId, plan: rec.plan });
        break;
      }
      // EVERY OTHER EVENT IS ROUTED BY THE TABLE, NOT BY HAND.
      //
      // What used to be here was a second `case` list — cancelled / canceled /
      // expired / failed — and it is worth saying exactly what was wrong with
      // it, because it did not look wrong. `subscription.canceled`, American
      // spelling, one L, IS NOT A DODO EVENT and never has been. It sat in this
      // switch reading like extra safety, so a reviewer checking whether
      // cancellation was covered saw it handled twice and stopped looking. Dead
      // code that resembles a handler is worse than a missing handler: it costs
      // you the search that would have found the real gap.
      //
      // The real gap was large. The live endpoint has `filter_types: null`,
      // which Dodo documents as NO FILTER, so ALL of its event types have been
      // arriving at this route from the day it was configured. Refunds,
      // disputes, dunning, pause/resume and plan changes all fell to the
      // `default:` branch below, were logged "ignored", and were answered
      // `received: true` — a webhook endpoint that was cheerfully telling the
      // payment provider "handled" about money moving back OUT of the business.
      // Nothing was broken in the dashboard; there were simply no handlers.
      //
      // DODO_EVENT_EFFECTS now holds the policy as data, so coverage is a
      // property a test can assert rather than a switch a reader has to audit,
      // and a name that is not a real Dodo event cannot pose as coverage.
      default: {
        const effect = dodoEventEffect(type);
        if (!effect) {
          console.log(`[dodo-webhook] ignored: ${type}`);
          break;
        }
        // applyDodoLifecycle NEVER THROWS — it reports failure in its return
        // value instead. That is the whole contract on this path: a throw here
        // would escape to the catch below, return 500, and make Dodo redeliver
        // the same dispute or refund forever. `received: true` with a loud
        // alert is the correct answer to an event we could not act on.
        // RESCUE THE BINDING BEFORE THE MIRROR WRITE LANDS ON IT.
        //
        // applyDodoLifecycle mirrors the updated subscription record onto the
        // connect key, and the subscription record is precisely the one that
        // does not carry a telegramId for a customer who paid before running
        // /start — the ordinary order. So the write below is, for those
        // customers, the moment the only copy of the binding disappears, and it
        // happens inside the call whose result we then use to decide who to
        // revoke. Reading the connect record afterwards finds the flattened
        // copy and concludes, wrongly and quietly, that there is nobody to
        // push to.
        //
        // This wrapper changes NOTHING about what is stored — putConnect is
        // still called with exactly the record the core built — it only reads
        // the key one moment earlier and keeps the id for the push. The real
        // repair belongs in claimConnect (store.ts), which should mirror the
        // bind onto the durable record; that file belongs to another writer, so
        // this is the honest fix inside my own.
        let boundTelegramId: number | undefined;
        const putConnectPreservingIdentity = async (r: ConnectRecord): Promise<void> => {
          try {
            if (boundTelegramId === undefined && r?.token && r.telegramId == null) {
              const prev = await getConnect(r.token);
              if (typeof prev?.telegramId === "number") boundTelegramId = prev.telegramId;
            }
          } catch {
            // A failed read here costs immediacy, never correctness.
          }
          await putConnect(r);
        };

        const outcome = await applyDodoLifecycle(data, type, {
          getSubscription,
          putSubscription,
          putConnect: putConnectPreservingIdentity,
          // The payment_id -> customer hop that disputes and refunds cannot do
          // without (gotchas#262).
          resolvePaymentIdentity,
          // plan_changed / updated re-resolve the tier from the product
          // actually paid for, through the SAME ladder activation uses.
          planForProductId,
        });
        console.log(`[dodo-webhook] ${type} → ${outcome.action}`, {
          customerId: outcome.customerId,
          changed: outcome.changed ?? false,
          note: outcome.note,
        });
        // THE LINE gotchas#262 EXISTS FOR. Without it everything above is a
        // record edit the assistant never sees, and a refunded customer keeps
        // their paid tier and their credits indefinitely.
        await pushLifecycleToEngine(type, effect, outcome, {
          eventId: id,
          eventAt,
          telegramId: boundTelegramId,
        });
        break;
      }
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
