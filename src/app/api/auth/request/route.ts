import { NextResponse } from "next/server";
import { mintMagicToken } from "@/lib/magic-link";
import { sendMail, magicLinkEmail, emailConfigured } from "@/lib/email";
import { appUrl } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * POST { email } — send a one-time sign-in link.
 * ALWAYS returns 200 ("if that email exists, a link is on its way") so the
 * endpoint can't be used to enumerate which emails have accounts. Rate-limited
 * per IP + per email. The magic token itself is single-use + 15-min TTL.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 4;
const hits = new Map<string, number[]>();

function limited(k: string): boolean {
  const now = Date.now();
  const arr = (hits.get(k) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(k, arr);
  if (hits.size > 5000) for (const [key, v] of hits) if (v.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(key);
  return arr.length > MAX_PER_WINDOW;
}

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(req: Request) {
  const ok = NextResponse.json({ ok: true, message: "If that email is valid, a sign-in link is on its way." });

  let email = "";
  try {
    email = String((await req.json())?.email ?? "").trim().toLowerCase();
  } catch {
    return ok;
  }
  if (!EMAIL_RE.test(email) || email.length > 254) return ok; // silently no-op on bad input
  if (limited(clientIp(req)) || limited(`e:${email}`)) return ok; // silent

  if (!emailConfigured()) {
    // Can't send — surface a real error so the operator notices in logs, but don't
    // leak to the client that this specific email would/wouldn't have worked.
    console.error("[auth/request] SMTP not configured — cannot send magic link");
    return ok;
  }

  try {
    const token = await mintMagicToken(email);
    const link = `${appUrl()}/api/auth/verify?token=${encodeURIComponent(token)}`;
    const { subject, html, text } = magicLinkEmail(link);
    await sendMail(email, subject, html, text);
  } catch (e) {
    console.error("[auth/request] send failed:", (e as Error).message);
  }
  return ok;
}
