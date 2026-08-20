import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Signed connect tokens, TELEGRAM DEEP-LINK SAFE.
 *
 * Format: `base64url(random16) + base64url(HMAC_SHA256(random16, MIRA_TOKEN_SECRET)[0..16])`
 *   -> exactly 44 chars, alphabet [A-Za-z0-9_-] only, NO "." separator.
 *
 * WHY: a Telegram `?start=` parameter is limited to 64 chars and only A-Z a-z 0-9 _ - .
 * The old format was `rand.mac` = 66 chars WITH a "." — Telegram silently DROPS the whole
 * parameter, so the bot receives a bare `/start` and the bind never happens (owner caught
 * this in the field). We drop the dot and truncate the MAC to 128 bits (still unforgeable;
 * the single-use, short-lived, store-backed record is the real source of truth) to fit.
 *
 * verifyConnectToken still accepts the LEGACY dotted format so any token minted before this
 * change keeps validating; mint only ever emits the new 44-char form.
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
  const rand = randomBytes(16); // 16 bytes -> 22 base64url chars
  const mac = createHmac("sha256", secret()).update(rand).digest().subarray(0, 16); // -> 22 chars
  // No "." separator: 22 + 22 = 44 chars, base64url alphabet only, well under Telegram's 64.
  return `${rand.toString("base64url")}${mac.toString("base64url")}`;
}

export function verifyConnectToken(token: string | null | undefined): boolean {
  if (!token) return false;
  try {
    // Legacy dotted format (rand "." full-32-byte-mac) — still accepted for tokens minted
    // before the Telegram-safe change, so an in-flight link doesn't suddenly 403.
    const dot = token.indexOf(".");
    if (dot > 0) {
      const rand = Buffer.from(token.slice(0, dot), "base64url");
      const got = Buffer.from(token.slice(dot + 1), "base64url");
      const expect = createHmac("sha256", secret()).update(rand).digest();
      return got.length === expect.length && timingSafeEqual(got, expect);
    }
    // New Telegram-safe format: fixed 44 chars = 22-char rand + 22-char truncated (16-byte) MAC.
    if (token.length !== 44) return false;
    const rand = Buffer.from(token.slice(0, 22), "base64url");
    const got = Buffer.from(token.slice(22), "base64url");
    if (rand.length !== 16 || got.length !== 16) return false;
    const expect = createHmac("sha256", secret()).update(rand).digest().subarray(0, 16);
    return timingSafeEqual(got, expect);
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
