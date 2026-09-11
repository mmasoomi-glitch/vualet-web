import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSubscriptionByEmail } from "@/lib/store";
import { channelHistoryForCustomer } from "@/lib/channel-event-log";

/**
 * GET /api/account/channel-history — the customer's own security events.
 *
 * Showing people what happened to their own account reduces disputes, because
 * they can see it rather than being told it. It shows only what happened and
 * when: the anti-fraud signals, internal state names and correlation ids stay
 * on the operator side, since publishing what trips the risk engine tells an
 * attacker exactly what to avoid.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.email) {
      return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
    }

    const found = await getSubscriptionByEmail(session.email);
    // A normal empty state, not an error. Someone with no subscription has no
    // channel history, and a 404 would read as something having gone wrong.
    if (!found) {
      return NextResponse.json({ events: [] });
    }

    const history = await channelHistoryForCustomer(found.customerId);

    // Mapped explicitly rather than spread. An explicit map is what stops a
    // field added to the internal shape later from silently appearing on a
    // customer-facing surface nobody re-reviewed.
    const events = history.map((e: { at: string; title: string; reason: string | null }) => ({
      at: e.at,
      title: e.title,
      reason: e.reason,
    }));

    return NextResponse.json({ events });
  } catch (err) {
    console.error("[channel-history]", err);
    // A customer's account page must not break because their history could not
    // be read. An empty list is a worse answer than the truth, but a far better
    // one than an error page over a read-only convenience.
    return NextResponse.json({ events: [] });
  }
}
