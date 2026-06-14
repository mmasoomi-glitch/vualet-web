import { NextResponse } from "next/server";

// Customer-service handler. Sample (Anthropic-style helpful) responses for now; wire to the Mira
// engine + real billing/refund actions later. Login is enforced on the client (cs-bot) and should
// also be verified here against the session once auth lands.
export async function POST(req: Request) {
  const { message } = await req.json().catch(() => ({ message: "" }));
  const m = String(message || "").toLowerCase();

  let reply: string;
  if (/refund|money back|charged twice|wrong charge/.test(m)) {
    reply =
      "I can help with that. Refunds are available within 14 days of a charge — I've logged your request, and you'll see it back on your original payment method within 5–10 business days. Want a confirmation sent to your account email?";
  } else if (/cancel|unsubscribe|stop (my )?subscription/.test(m)) {
    reply =
      "You can cancel anytime from Settings → Billing, and you'll keep full access until the end of your current period. Want me to walk you through it?";
  } else if (/bill|invoice|payment method|charge|receipt/.test(m)) {
    reply =
      "Happy to help with billing — I can pull your latest invoice, update your payment method, or explain a charge. Which would you like?";
  } else if (/down|not working|broken|error|bug|incident/.test(m)) {
    reply =
      "Sorry you're hitting trouble — let's fix it. Tell me what you were doing and what you saw, and I'll log an incident and get it to the team right away.";
  } else {
    reply =
      "Thanks for reaching out — I'm here for refunds, billing, cancellations, and any issue. Tell me a bit more and I'll sort it out.";
  }

  return NextResponse.json({ reply });
}
