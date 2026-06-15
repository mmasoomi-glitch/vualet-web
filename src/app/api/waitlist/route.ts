import { NextResponse } from "next/server";
import { kvSet } from "@/lib/store";

// Real waitlist capture for not-yet-self-serve products. Persists the email and
// bounces back to a thank-you state. (Mira itself goes straight to checkout.)
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const email = String(form?.get("email") ?? "").trim().toLowerCase();
  const origin = new URL(req.url).origin;

  if (!email || !email.includes("@")) {
    return NextResponse.redirect(`${origin}/signup?error=1`, { status: 303 });
  }
  try {
    await kvSet(`waitlist:${email}`, { email, at: new Date().toISOString() });
  } catch (err) {
    console.error("[waitlist] persist failed:", err);
  }
  return NextResponse.redirect(`${origin}/signup?joined=1`, { status: 303 });
}
