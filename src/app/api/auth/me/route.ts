import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { entitlementForEmail } from "@/lib/entitlement";

export const runtime = "nodejs";

/**
 * GET /api/auth/me — the ONLY authority the client should trust for "who am I"
 * and "have I paid". Reads the signed httpOnly session server-side; if present,
 * resolves live entitlement from Stripe. Never trusts anything the client sends.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }
  const ent = await entitlementForEmail(session.email);
  return NextResponse.json({
    authenticated: true,
    email: session.email,
    entitlement: {
      active: ent.active,
      status: ent.status,
      plan: ent.plan,
      customerId: ent.customerId,
    },
  });
}
