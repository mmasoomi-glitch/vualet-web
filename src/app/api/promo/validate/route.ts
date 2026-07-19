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
