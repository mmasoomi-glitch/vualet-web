import { NextResponse } from "next/server";
import { mintConnectToken } from "@/lib/connect-token";
import { putConnect } from "@/lib/store";
import { whatsappPairUrl } from "@/lib/pairing";
import { redeemRecovery, getBinding } from "@/lib/channel-binding-store";
import { recordChannelEvent } from "@/lib/channel-event-log";
import { CHANNEL_EVENTS } from "@/lib/channel-events.mjs";

/**
 * POST /api/channel/reconnect — spend a reconnect link.
 *
 * ── WHY SPENDING THE LINK DOES NOT ITSELF RECONNECT ANYTHING ──────────────
 * The link is delivered over WhatsApp, to the very number whose binding is
 * broken, so anyone holding that phone holds the link. Treating the link alone
 * as proof would mean phone possession had authenticated the account, and it
 * would also mean a link sitting unread in a chat ten minutes ago could still
 * reconnect a number that has since been lost.
 *
 * So this route does not reconnect. It hands back a fresh WhatsApp pairing
 * session, and the reconnection happens only when the customer scans the QR —
 * which proves control of the number NOW rather than at the moment the link
 * was issued.
 *
 * ── WHY THERE IS NO EMAIL STEP HERE ───────────────────────────────────────
 * A reconnect can only ever restore the number it was issued for. It cannot
 * move the account onto a different number: the connect record carries
 * `expectedChannelIdHash`, and the bind step refuses a scan from anything else.
 * Since the link went to an identifier already bound to this account, and the
 * scan proves that identifier is live, an email round-trip would add friction
 * without adding a factor — and routine recovery that requires going to find
 * an email is a manual recovery workflow wearing a disguise.
 *
 * Changing the bound number is a different flow and DOES require
 * authentication against the canonical account.
 */
export const dynamic = "force-dynamic";

/**
 * These codes distinguish states of a TOKEN, which a caller can only reach by
 * already holding a real one — a 32-byte random string is not guessable. None
 * of them reveals whether an account exists for any given phone number, which
 * is the disclosure that would actually matter.
 */
const FAILURES: Record<string, { code: string; message: string }> = {
  EXPIRED: {
    code: "link_expired",
    message:
      "This link has expired. Message the assistant again and it will send you a fresh one straight away.",
  },
  USED: {
    code: "link_used",
    message:
      "This link has already been used. If you still need to reconnect, message the assistant again for a new one.",
  },
  REVOKED: {
    code: "link_revoked",
    message: "This link is no longer valid. Message the assistant again to get a new one.",
  },
  MISMATCHED: {
    code: "wrong_link",
    message: "This link was created for something else. Message the assistant again to reconnect.",
  },
};

const INVALID = {
  code: "link_invalid",
  message: "This link isn't valid. Message the assistant again and it will send you a new one.",
};

export async function POST(req: Request) {
  try {
    let body: { token?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const now = Date.now();
    const redeemed = await redeemRecovery(token, now, "RECONNECT_SAME_NUMBER");

    if (!redeemed.ok) {
      // An expired link and a REPLAYED one are different events on purpose:
      // one is a customer who walked away, the other is a double click or an
      // attacker, and a dispute later turns on which it was.
      void recordChannelEvent({
        eventType:
          redeemed.state === "EXPIRED"
            ? CHANNEL_EVENTS.RecoveryLinkExpired
            : CHANNEL_EVENTS.RecoveryFailed,
        actorType: "CUSTOMER",
        source: "RECONNECT_LINK",
        detail: { outcome: redeemed.state },
      });
      const failure = FAILURES[redeemed.state] ?? INVALID;
      return NextResponse.json({ error: failure.code, message: failure.message }, { status: 400 });
    }

    const { record } = redeemed;

    if (!record.oldBindingId) {
      return NextResponse.json({ error: "no_binding" }, { status: 409 });
    }
    const binding = await getBinding(record.oldBindingId);
    if (!binding) {
      return NextResponse.json({ error: "no_binding" }, { status: 409 });
    }

    // Defence in depth. The token already encodes the account, so the binding
    // agreeing is expected; a disagreement means something is wrong upstream,
    // and picking one of the two answers would be guessing about whose account
    // to reconnect.
    if (binding.accountId !== record.accountId) {
      return NextResponse.json({ error: "binding_mismatch" }, { status: 409 });
    }

    const pairToken = mintConnectToken();
    await putConnect({
      token: pairToken,
      plan: "reconnect",
      status: "pending",
      channel: "whatsapp",
      customerId: record.accountId,
      reconnectOfBindingId: binding.bindingId,
      // The bind step compares the scanning account against this and refuses a
      // mismatch. It is what makes "a reconnect can never become a number
      // change" an enforced rule rather than an intention.
      expectedChannelIdHash: binding.channelIdHash,
      createdAt: new Date(now).toISOString(),
    });

    void recordChannelEvent({
      eventType: CHANNEL_EVENTS.RecoveryLinkUsed,
      actorType: "CUSTOMER",
      accountId: record.accountId,
      bindingId: binding.bindingId,
      source: "RECONNECT_LINK",
      correlationId: record.recoveryId,
    });

    // The QR page lives behind the gateway, so the customer needs the built URL
    // rather than a bare token. A null here means the gateway is unconfigured,
    // which is an operational fault, not something to hide from the caller.
    const pairUrl = whatsappPairUrl(pairToken);

    return NextResponse.json({ ok: true, pairToken, pairUrl, accountId: record.accountId });
  } catch (err) {
    console.error("[channel-reconnect]", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
