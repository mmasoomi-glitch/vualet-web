import { NextResponse } from "next/server";
import { kvSet } from "@/lib/store";

// Real waitlist capture for not-yet-self-serve products. Persists the email and
// bounces back to a thank-you state. (Mira itself goes straight to checkout.)
//
// RFC 5321 caps a full email address at 254 chars; the regex is a pragmatic
// (not exhaustive) shape check — good enough to reject garbage/oversized input
// before it hits the store, not a full RFC 5322 parser.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LEN = 254;

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const email = String(form?.get("email") ?? "").trim().toLowerCase();
  const origin = new URL(req.url).origin;

  if (!email || email.length > EMAIL_MAX_LEN || !EMAIL_RE.test(email)) {
    return NextResponse.redirect(`${origin}/signup?error=1`, { status: 303 });
  }
  try {
    await kvSet(`waitlist:${email}`, { email, at: new Date().toISOString() });
  } catch (err) {
    console.error("[waitlist] persist failed:", err);
  }
  return NextResponse.redirect(`${origin}/signup?joined=1`, { status: 303 });
}
