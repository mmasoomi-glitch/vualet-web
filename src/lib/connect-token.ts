import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Signed connect tokens: `base64url(random16) + "." + base64url(HMAC_SHA256(random16, MIRA_TOKEN_SECRET))`.
 * The KV record is still the source of truth; the HMAC only makes tokens
 * unforgeable so /api/connect can reject guesses before touching the store.
 */

function secret(): string {
  const s = process.env.MIRA_TOKEN_SECRET;
  if (s) return s;
  // Hard-fail in production (parity with MIRA_BIND_SECRET, which 503s when unset):
  // a missing secret here silently makes every connect token forgeable with a
  // string that lives in the public repo. Refuse rather than degrade.
  if (process.env.NODE_ENV === "production") {
    throw new Error("MIRA_TOKEN_SECRET is unset in production — refusing to mint/verify forgeable connect tokens.");
  }
  return "mira-dev-token-secret-not-for-production";
}

export function mintConnectToken(): string {
  const rand = randomBytes(16);
  const mac = createHmac("sha256", secret()).update(rand).digest();
  return `${rand.toString("base64url")}.${mac.toString("base64url")}`;
}

export function verifyConnectToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  try {
    const rand = Buffer.from(token.slice(0, dot), "base64url");
    const got = Buffer.from(token.slice(dot + 1), "base64url");
    const expect = createHmac("sha256", secret()).update(rand).digest();
    return got.length === expect.length && timingSafeEqual(got, expect);
  } catch {
    return false;
  }
}

/** Constant-time string compare for shared secrets (bind secret, admin session). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
