import { NextResponse } from "next/server";
import { consumeMagicToken } from "@/lib/magic-link";
import { setSession } from "@/lib/session";
import { appUrl } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * GET /api/auth/verify?token=… — the target of the emailed link.
 * Consumes the single-use token, and on success sets the httpOnly login session
 * cookie and redirects to the account page. On failure, redirects to /mira/login
 * with an error flag (expired/already-used links land here).
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const email = await consumeMagicToken(token);
  const base = appUrl();
  if (!email) {
    return NextResponse.redirect(`${base}/mira/login?e=expired`, { status: 303 });
  }
  await setSession(email);
  return NextResponse.redirect(`${base}/mira/account?welcome=1`, { status: 303 });
}
