import { createHmac } from "crypto";
import { safeEqual } from "@/lib/connect-token";

/**
 * Admin session cookie: `<expiryMs>.<base64url(HMAC_SHA256(expiryMs, ADMIN_SESSION_SECRET))>`.
 * Minted by POST /api/admin/login after the ADMIN_PASSWORD check; verified
 * server-side (middleware uses the Web Crypto equivalent). httpOnly — the
 * browser never reads it.
 */

export const ADMIN_COOKIE = "mira_admin";
export const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_SESSION_SECRET);
}

export function mintAdminSession(): string {
  const exp = String(Date.now() + ADMIN_SESSION_TTL_MS);
  const sig = createHmac("sha256", process.env.ADMIN_SESSION_SECRET!).update(exp).digest("base64url");
  return `${exp}.${sig}`;
}

export function verifyAdminSession(value: string | undefined | null): boolean {
  if (!value || !process.env.ADMIN_SESSION_SECRET) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const exp = value.slice(0, dot);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expect = createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(exp).digest("base64url");
  return safeEqual(value.slice(dot + 1), expect);
}
