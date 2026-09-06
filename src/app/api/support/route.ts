import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

/**
 * Support chat — a signpost, not an agent.
 *
 * WHAT THIS ROUTE IS: a static reply engine that tells a customer which page
 * to go to. It has no database, no mail transport, and no ability to act for
 * the caller.
 *
 * WHAT IT IS NOT, and must never claim to be: it does not log, escalate,
 * refund, cancel, schedule, send email, pull invoices, or change any state.
 *
 * WHY THAT WARNING IS AT THE TOP (gotchas, 2026-09-06). This route previously
 * told anyone who typed "refund" that it had "logged your request" and that
 * they would "see it back on your original payment method within 5-10 business
 * days". Nothing was logged and no refund was ever initiated. It is mounted by
 * src/components/site-chrome.tsx on every public corporate page, so that
 * sentence was live to every visitor of a site that takes real card payments.
 * A customer waits ten days on a promise like that and then discovers the
 * merchant lied. THE RULE THIS LEAVES BEHIND: a placeholder that SPEAKS TO
 * CUSTOMERS is not a placeholder, it is published copy.
 *
 * TWO FACTS ABOUT THE DESTINATIONS, checked 2026-09-06, that constrain the
 * wording below and must be re-checked before it is loosened:
 *  - /mira/account genuinely carries the buttons named here: "Manage billing",
 *    "Cancel plan" and "Request a refund". Cancelling is self-serve; a refund
 *    is a REQUEST that a person reviews (see api/subscription/refund-request).
 *  - /api/contact appends to a JSONL file and sends NO mail to anyone. The
 *    operator retrieves it with GET /api/contact?key=CONTACT_EXPORT_KEY. So we
 *    may say a message is recorded. We may NOT say anyone will read it, or
 *    when. If a transport is ever wired, this comment is the thing to update.
 *
 * The session is checked SERVER-SIDE for any reply that touches account state.
 * On no session we still answer helpfully rather than returning 401, because
 * cs-bot.tsx renders a non-OK response as "Sorry, something went wrong."
 */
export async function POST(req: Request) {
  const { message } = await req.json().catch(() => ({ message: "" }));
  const m = String(message || "").toLowerCase();
  const session = await getSession();
  const signedIn = Boolean(session?.email);

  let reply: string;
  if (/refund|money back|charged twice|wrong charge/.test(m)) {
    reply = signedIn
      ? "I can't process a refund myself. You can ask for one with the \u201cRequest a refund\u201d button on your account page at /mira/account \u2014 a person reviews every request, so it isn't automatic and I can't tell you a date. If you want billing to stop straight away, \u201cCancel plan\u201d on that same page is immediate and self-serve."
      : "I can't process a refund myself. Sign in and use the \u201cRequest a refund\u201d button at /mira/account \u2014 a person reviews every request. If you can't get in, /contact is the other way to reach us.";
  } else if (/cancel|unsubscribe|stop (my )?subscription/.test(m)) {
    reply = signedIn
      ? "You can do this yourself right now: \u201cCancel plan\u201d at /mira/account. You keep everything you've paid for until the end of your current period."
      : "You can do this yourself once signed in: \u201cCancel plan\u201d at /mira/account. You keep everything you've paid for until the end of your current period.";
  } else if (/bill|invoice|payment method|charge|receipt/.test(m)) {
    reply = signedIn
      ? "I can't look at your billing, but you can. \u201cManage billing\u201d at /mira/account opens your billing portal, where invoices and payment details live."
      : "I can't look at your billing. Sign in and use \u201cManage billing\u201d at /mira/account to open your billing portal, where invoices and payment details live.";
  } else if (/down|not working|broken|error|bug|incident/.test(m)) {
    reply =
      "Sorry you're hitting trouble. I should be straight with you: I can't raise this with anyone \u2014 nothing you type here reaches a person. Writing it up at /contact does record it, with what you were doing and what you saw, and that is the channel we actually collect.";
  } else {
    reply =
      "Thanks for reaching out. I can't change anything on your account, but I can tell you where to go \u2014 refunds, cancelling, invoices, or reaching us at /contact. What do you need?";
  }

  return NextResponse.json({ reply });
}
