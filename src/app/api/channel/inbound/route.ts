import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/connect-token";
import { classifyInbound, ACTIONS } from "@/lib/channel-binding-core.mjs";
import {
  findBindingByChannel,
  issueRecovery,
  touchBinding,
  type BindingRecord,
} from "@/lib/channel-binding-store";
import { recordChannelEvent } from "@/lib/channel-event-log";
import { CHANNEL_EVENTS } from "@/lib/channel-events.mjs";

/**
 * POST /api/channel/inbound — THE ENGINE'S CALLBACK FOR AN ARRIVING MESSAGE.
 *
 * ── WHY THIS ROUTE EXISTS ─────────────────────────────────────────────────
 * The overriding rule of the channel-recovery work is that there must be NO
 * normal manual recovery workflow. A customer whose WhatsApp session broke
 * should be able to send "Hi" and get a secure reconnect link back, with no
 * employee involved.
 *
 * The two halves of that are on different machines. The engine holds the
 * WhatsApp socket and is the only thing that sees the message arrive. This app
 * holds the identity: the bindings, the account, the entitlement and the
 * policy that decides whether this sender may be served at all. So the engine
 * asks, and this app answers — the same shape as /api/pair/bind, with the same
 * shared secret, because it is the same trust relationship.
 *
 * THE ENGINE IS A SEPARATE PROJECT AND IS NOT MODIFIED BY THIS COMMIT. This
 * side is complete and the contract below is what the engine side adopts.
 *
 * ── THE CONTRACT ──────────────────────────────────────────────────────────
 *
 *     POST https://mira.vualet.com/api/channel/inbound
 *     x-mira-bind-secret: <MIRA_BIND_SECRET>
 *     Content-Type: application/json
 *     { "channelType": "whatsapp",
 *       "identifier": "<account JID, e.g. 12025551234@s.whatsapp.net>" }
 *
 *     200 { action, class, accountId, bindingId, reply, reconnectUrl?, expiresInSeconds? }
 *     400 { error: "invalid body" }
 *     401 { error: "unauthorized" }
 *     503 { error: "not_configured" }
 *
 * `action` is one of SERVE, OFFER_RECONNECT, OFFER_ONBOARDING, REFUSE,
 * HOLD_FOR_MIGRATION. The engine sends `reply` when present and serves the
 * assistant normally only on SERVE.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
 * The message TEXT is not accepted and not wanted. Deciding whether a sender
 * is authenticated must not depend on what they typed — "I changed my number"
 * is a claim, not a credential, and a route that read it would be inviting
 * itself to be talked into something.
 */
export const dynamic = "force-dynamic";

const RECONNECT_BASE = "/mira/reconnect";

/** Warm, honest, and free of internal detail. A customer reads these. */
const REPLIES = Object.freeze({
  RECONNECT:
    "Your WhatsApp connection is no longer active.\n\nFor your security, please reconnect using the secure link below. It is unique to you and expires in 10 minutes.",
  RECONNECT_RATE_LIMITED:
    "I've just sent you a reconnect link — please check your messages just above. If it has expired, message me again in a minute and I'll send a fresh one.",
  ONBOARDING:
    "Welcome. I don't recognise this number yet — you can create or connect your account to get started.",
  REFUSED:
    "I can't continue on this number. If you believe this is a mistake, please contact support from your account.",
  MIGRATING:
    "Your number change is still in progress. Once it's confirmed I'll pick up right where we left off.",
});

export async function POST(req: Request) {
  // AUTH FIRST, the same secret and the same fail-closed rule as /api/pair/bind:
  // this is the same trust relationship, and a second secret would be a second
  // thing to rotate and forget.
  const secret = process.env.MIRA_BIND_SECRET;
  const presented = req.headers.get("x-mira-bind-secret") ?? "";
  if (secret) {
    if (!safeEqual(presented, secret)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.warn("[channel-inbound] MIRA_BIND_SECRET unset in production — refusing engine calls.");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let body: { channelType?: unknown; identifier?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const channelType = typeof body.channelType === "string" ? body.channelType.trim() : "whatsapp";
  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  if (!identifier) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const nowMs = Date.now();
  let binding: BindingRecord | null = null;
  try {
    binding = await findBindingByChannel(channelType, identifier);
  } catch (err) {
    // A lookup failure must not be indistinguishable from "unknown sender":
    // treating a broken store as an unknown number would silently onboard an
    // existing customer as a stranger.
    console.error("[channel-inbound] binding lookup failed:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const verdict = classifyInbound({
    binding,
    securityBlocked: false,
    migrationPending: false,
  });

  if (verdict.action === ACTIONS.SERVE) {
    if (verdict.bindingId) await touchBinding(verdict.bindingId, nowMs).catch(() => {});
    return NextResponse.json({
      action: verdict.action,
      class: verdict.klass,
      accountId: verdict.accountId,
      bindingId: verdict.bindingId,
      reply: null,
    });
  }

  if (verdict.action === ACTIONS.OFFER_RECONNECT && verdict.accountId) {
    const issued = await issueRecovery({
      accountId: verdict.accountId,
      oldBindingId: verdict.bindingId,
      purpose: "RECONNECT_SAME_NUMBER",
      nowMs,
      requestSource: "WHATSAPP_INBOUND",
    });

    if (!issued.ok) {
      // Rate limited. The customer is told something warm and true rather than
      // nothing, and no new link is minted — that limit is what stops an
      // attacker pumping their phone with links.
      return NextResponse.json({
        action: verdict.action,
        class: verdict.klass,
        accountId: verdict.accountId,
        bindingId: verdict.bindingId,
        reply: REPLIES.RECONNECT_RATE_LIMITED,
        retryAfterMs: issued.retryAfterMs,
      });
    }

    // Evidence, written after the fact and never gating the reply: a customer
    // must not fail to get their link because the log was unavailable.
    void recordChannelEvent({
      eventType: CHANNEL_EVENTS.RecoveryLinkIssued,
      actorType: "SYSTEM",
      accountId: verdict.accountId,
      bindingId: verdict.bindingId,
      source: "WHATSAPP_INBOUND",
      newState: "REAUTH_REQUIRED",
      correlationId: issued.record.recoveryId,
      detail: { expiresAtMs: issued.record.expiresAt, reused: issued.reused },
    });

    const base = (process.env.MIRA_WEB_URL || "").replace(/\/+$/, "");
    return NextResponse.json({
      action: verdict.action,
      class: verdict.klass,
      accountId: verdict.accountId,
      bindingId: verdict.bindingId,
      reply: REPLIES.RECONNECT,
      reconnectUrl: `${base}${RECONNECT_BASE}?t=${encodeURIComponent(issued.token)}`,
      expiresInSeconds: Math.max(0, Math.floor((issued.record.expiresAt - nowMs) / 1000)),
    });
  }

  const reply =
    verdict.action === ACTIONS.OFFER_ONBOARDING
      ? REPLIES.ONBOARDING
      : verdict.action === ACTIONS.HOLD_FOR_MIGRATION
        ? REPLIES.MIGRATING
        : REPLIES.REFUSED;

  // A refusal names no account. The sender of a revoked number may be a
  // stranger who was reassigned it, and telling them whose account it was
  // would be handing a previous customer's identity to whoever holds the
  // number now.
  const safeAccount = verdict.action === ACTIONS.REFUSE ? null : verdict.accountId;
  return NextResponse.json({
    action: verdict.action,
    class: verdict.klass,
    accountId: safeAccount,
    bindingId: verdict.action === ACTIONS.REFUSE ? null : verdict.bindingId,
    reply,
  });
}
