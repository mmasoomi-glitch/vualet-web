import { NextResponse } from "next/server";
import { isPaidPlan, paymentsConfigured } from "@/lib/stripe";
import { validatePromo } from "@/lib/promo";

// Validates a customer-entered promotion code SERVER-SIDE against Stripe and
// prices it against the plan's server price. The browser never sees a price it
// can tamper with — it only renders what this route computes.
// Body: { code: string, plan: "companion" | "assistant" | "studio" }
export async function POST(req: Request) {
  let body: { code?: string; plan?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ valid: false, reason: "Invalid request." }, { status: 400 });
  }

  const { code, plan } = body;
  if (!isPaidPlan(plan)) {
    return NextResponse.json({ valid: false, reason: "Pick a paid plan first." }, { status: 400 });
  }

  // KILL SWITCH (jury verdict #96, 2026-08-04) — DEFAULT OFF, deliberately.
  //
  // This route validates codes against STRIPE, but production charges through
  // DODO, and /api/checkout does not forward promoCode to the charge at all.
  // The result was a live mischarge trap: a customer entered a 100%-off code,
  // this route told them the total was $0, and their card was then charged the
  // full price. Refusing every code is honest and safe; quoting a discount we
  // cannot honour is neither.
  //
  // Re-enable ONLY once /api/checkout actually applies the discount end-to-end
  // (defect A), by setting PROMO_CODES_ENABLED=1.
  if (process.env.PROMO_CODES_ENABLED !== "1") {
    return NextResponse.json({
      valid: false,
      reason: "Discount codes are temporarily unavailable. Contact us and we'll apply it manually.",
    });
  }
  if (!paymentsConfigured()) {
    return NextResponse.json(
      { valid: false, reason: "Payments aren't switched on yet." },
      { status: 503 },
    );
  }

  try {
    const result = await validatePromo(code ?? "", plan);
    // Always 200 for a decision Stripe could make (valid or not); the client
    // branches on result.valid. Only infra failures below return non-200.
    return NextResponse.json(result);
  } catch (err) {
    console.error("[promo/validate] failed:", err);
    return NextResponse.json(
      { valid: false, reason: "Couldn't check that code. Try again." },
      { status: 502 },
    );
  }
}
