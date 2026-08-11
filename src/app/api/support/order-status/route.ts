import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSubscriptionByEmail } from "@/lib/store";
import { summariseOrderForCustomer } from "@/lib/support-core.mjs";

/**
 * The customer-service bot's read-only window onto a customer's OWN order
 * (jury verdict #107, constraint 3).
 *
 * Before this, the bot had no honest way to answer "what am I actually on?" —
 * so it either guessed or sent every billing question to a human. It can now
 * answer from the record, in plain language, for the person in front of it and
 * nobody else.
 *
 * WHAT THIS ROUTE MAY DO: read the signed-in customer's own plan and status and
 * describe it warmly.
 * WHAT IT MAY NEVER DO: act on the plan, name another customer's plan, expose a
 * provider identifier, or form an opinion about a refund. Refund adjudication is
 * a human's job — see src/lib/support-core.mjs, where that boundary is enforced
 * by a guard that throws rather than by a flag someone can flip.
 *
 * Anti-IDOR, copied verbatim in shape from /api/subscription/cancel: the handler
 * takes NO request parameter, so there is no body, no query string and no header
 * that could name whose order to read. Identity comes only from the verified
 * session cookie. There is nothing here to tamper with and nothing to enumerate.
 *
 * The response body is only the customer-safe summary. The raw record is never
 * spread into it, and support-core throws if an internal id or a provider name
 * ever reaches the customer-facing text.
 */

// Reads a per-user cookie: never cache this, and never serve one customer's
// summary to another.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session?.email) {
    return NextResponse.json(
      {
        error: "not_signed_in",
        message: "Sign in and I can pull up your plan for you.",
      },
      { status: 401 },
    );
  }

  const found = await getSubscriptionByEmail(session.email);

  // No record is a person, not an error state. Give them the same warm summary
  // and a route to a human instead of a bare 404 body.
  if (!found) {
    const summary = summariseOrderForCustomer(null);
    return NextResponse.json(
      { error: "no_subscription", found: false, summary, message: summary.text },
      { status: 404 },
    );
  }

  // Only rec is read. customerId is deliberately left behind — the customer has
  // no use for it and it is not ours to hand out.
  const summary = summariseOrderForCustomer(found.rec);

  return NextResponse.json({ ok: true, found: true, summary, message: summary.text });
}
