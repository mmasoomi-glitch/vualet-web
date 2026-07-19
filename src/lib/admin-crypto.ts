import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv } from "crypto";

/**
 * Cryptographic helpers for the admin control plane.
 *
 * All admin secrets derive from ADMIN_SESSION_SECRET (the same secret the
 * middleware/session already require). We NEVER store a TOTP secret or password
 * in plaintext:
 *   - passwords  → scrypt salted hash (verify-only, one-way)
 *   - TOTP seeds → AES-256-GCM, encrypted at rest with a key derived from
 *                  ADMIN_SESSION_SECRET (reversible only server-side)
 *
 * Mirrors the existing repo convention (src/lib/session.ts, connect-token.ts):
 * hard-fail in production if the secret is unset rather than degrade to a
 * forgeable/guessable default.
 */

export function adminSecret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_SESSION_SECRET is unset in production — refusing to run the admin control plane with a default secret.");
  }
  return "mira-dev-admin-secret-not-for-production";
}

/** Derive a purpose-bound 32-byte key from the master admin secret. */
function derivedKey(purpose: string): Buffer {
  return createHash("sha256").update(`${adminSecret()}::${purpose}`).digest();
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** URL-safe random identifier, e.g. adm_9f3a…, ses_…, inv_… */
export function randomId(prefix: string, bytes = 12): string {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

// ---- Passwords (one-way) --------------------------------------------------

/** `scrypt.<saltB64>.<hashB64>` — never reversible. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt.${salt.toString("base64url")}.${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string | undefined | null): boolean {
  if (!stored) return false;
  const parts = stored.split(".");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "base64url");
    const expected = Buffer.from(parts[2], "base64url");
    const got = scryptSync(password, salt, expected.length);
    return got.length === expected.length && timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}

// ---- TOTP seed encryption (reversible, server-side only) ------------------

/** `v1.<ivB64>.<tagB64>.<cipherB64>` (AES-256-GCM). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey("totp"), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`;
}

export function decryptSecret(blob: string | undefined | null): string | null {
  if (!blob) return null;
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ct = Buffer.from(parts[3], "base64url");
    const decipher = createDecipheriv("aes-256-gcm", derivedKey("totp"), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ---- Signing (session / invite / reauth tokens) ---------------------------

export function signPayload(payloadB64: string, purpose: string): string {
  return createHmac("sha256", derivedKey(`sign:${purpose}`)).update(payloadB64).digest("base64url");
}

export function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
