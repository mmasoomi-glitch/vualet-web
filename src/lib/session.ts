import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { sessionSecret } from "@/lib/session-secret";

/**
 * Server-side login session for Mira (magic-link auth, jury verdict A 2026-07-18).
 *
 * The session is a signed cookie: `base64url(JSON{email,exp}) + "." + HMAC_SHA256`.
 * It is httpOnly + Secure + SameSite=Lax, so client JS can never read or forge it —
 * the SERVER decides who you are from this cookie, never localStorage. Entitlement
 * (has this person paid?) is resolved separately from the verified email.
 */

export const SESSION_COOKIE = "mira_session";
const TTL_S = 60 * 60 * 24 * 30; // 30 days

const secret = () => sessionSecret("sessions");

export type SessionData = { email: string; exp: number };

function sign(payloadB64: string): string {
  return createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

export function createSessionToken(email: string, ttlSeconds = TTL_S): string {
  const data: SessionData = { email: email.toLowerCase(), exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null): SessionData | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  try {
    const got = Buffer.from(mac);
    const expect = Buffer.from(sign(payload));
    if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionData;
    if (!data.email || typeof data.exp !== "number" || data.exp < Math.floor(Date.now() / 1000)) return null;
    return { email: data.email, exp: data.exp };
  } catch {
    return null;
  }
}

/** Read the current login session (App Router server components / routes). */
export async function getSession(): Promise<SessionData | null> {
  const c = await cookies();
  return verifySessionToken(c.get(SESSION_COOKIE)?.value);
}

export async function setSession(email: string): Promise<void> {
  const c = await cookies();
  c.set(SESSION_COOKIE, createSessionToken(email), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: TTL_S,
  });
}

export async function clearSession(): Promise<void> {
  const c = await cookies();
  c.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
}
