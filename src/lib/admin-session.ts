import { cookies } from "next/headers";
import { kvGet, kvSet, kvDel } from "@/lib/store";
import { signPayload, safeEqualStr, randomId } from "@/lib/admin-crypto";
import type { AdminRole } from "@/lib/admin-roles";

/**
 * PER-ADMIN SESSIONS (backend-generalised §5/§15).
 *
 * Replaces the single undifferentiated admin cookie. Three signed cookies:
 *   - mira_admin         full session AFTER MFA: {sid, aid, roles, mfa:true, exp}
 *   - mira_admin_pending short pre-MFA step:      {aid, purpose, exp}
 *   - mira_admin_reauth  fresh MFA proof for dangerous actions: {aid, exp}
 *
 * All are httpOnly + Secure(prod) + SameSite=Lax, HMAC-signed with a key derived
 * from ADMIN_SESSION_SECRET (admin-crypto). The cookie is a bearer of identity
 * only — authority is re-resolved server-side each request from the account
 * store, and a matching SERVER SESSION RECORD must still exist (revocation).
 */

export const ADMIN_COOKIE = "mira_admin";
export const PENDING_COOKIE = "mira_admin_pending";
export const REAUTH_COOKIE = "mira_admin_reauth";

export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h — short privileged session (§5)
export const PENDING_TTL_MS = 10 * 60 * 1000; // 10m to complete MFA
export const REAUTH_TTL_MS = 5 * 60 * 1000; // 5m reauth validity for dangerous actions

/** The admin plane is "configured" once the signing secret exists. */
export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_SESSION_SECRET);
}

// ---- token encode/decode --------------------------------------------------

function encode(payload: object, purpose: string): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${b64}.${signPayload(b64, purpose)}`;
}

function decode<T>(value: string | undefined | null, purpose: string): T | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const b64 = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!safeEqualStr(sig, signPayload(b64, purpose))) return null;
  try {
    const data = JSON.parse(Buffer.from(b64, "base64url").toString()) as { exp?: number };
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data as T;
  } catch {
    return null;
  }
}

// ---- full session ---------------------------------------------------------

export type AdminSessionPayload = { sid: string; aid: string; roles: AdminRole[]; mfa: true; exp: number };

export function mintAdminSession(sid: string, aid: string, roles: AdminRole[]): string {
  return encode({ sid, aid, roles, mfa: true, exp: Date.now() + ADMIN_SESSION_TTL_MS }, "session");
}

export function verifyAdminSession(value: string | undefined | null): AdminSessionPayload | null {
  const p = decode<AdminSessionPayload>(value, "session");
  return p && p.mfa === true && p.sid && p.aid ? p : null;
}

// ---- pending (pre-MFA) ----------------------------------------------------

export type PendingPayload = { aid: string; purpose: "mfa" | "enroll"; exp: number };

export function mintPending(aid: string, purpose: "mfa" | "enroll"): string {
  return encode({ aid, purpose, exp: Date.now() + PENDING_TTL_MS }, "pending");
}

export function verifyPending(value: string | undefined | null): PendingPayload | null {
  return decode<PendingPayload>(value, "pending");
}

// ---- reauth (dangerous-action proof) --------------------------------------

export function mintReauth(aid: string): string {
  return encode({ aid, exp: Date.now() + REAUTH_TTL_MS }, "reauth");
}

export function verifyReauth(value: string | undefined | null, aid: string): boolean {
  const p = decode<{ aid: string; exp: number }>(value, "reauth");
  return Boolean(p && p.aid === aid);
}

// ---- server session records (revocation + active-session list) ------------

export type SessionRecord = {
  sid: string;
  aid: string;
  createdAt: string;
  lastSeen: string;
  ip?: string;
  ua?: string;
};

const sessKey = (sid: string) => `mira:admin:session:${sid}`;
const sessIndexKey = (aid: string) => `mira:admin:sessions:${aid}`;

export async function createSessionRecord(aid: string, ip?: string, ua?: string): Promise<SessionRecord> {
  const rec: SessionRecord = {
    sid: randomId("ses"),
    aid,
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    ip,
    ua,
  };
  await kvSet(sessKey(rec.sid), rec, Math.ceil(ADMIN_SESSION_TTL_MS / 1000));
  const idx = (await kvGet<string[]>(sessIndexKey(aid))) ?? [];
  idx.push(rec.sid);
  await kvSet(sessIndexKey(aid), idx);
  return rec;
}

export async function getSessionRecord(sid: string): Promise<SessionRecord | null> {
  return kvGet<SessionRecord>(sessKey(sid));
}

export async function touchSession(sid: string): Promise<void> {
  const rec = await getSessionRecord(sid);
  if (!rec) return;
  rec.lastSeen = new Date().toISOString();
  await kvSet(sessKey(sid), rec, Math.ceil(ADMIN_SESSION_TTL_MS / 1000));
}

export async function revokeSession(sid: string): Promise<void> {
  await kvDel(sessKey(sid));
}

export async function listSessions(aid: string): Promise<SessionRecord[]> {
  const idx = (await kvGet<string[]>(sessIndexKey(aid))) ?? [];
  const out: SessionRecord[] = [];
  for (const sid of idx) {
    const rec = await getSessionRecord(sid);
    if (rec) out.push(rec);
  }
  return out;
}

// ---- cookie helpers (App Router) ------------------------------------------

function cookieOpts(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.ceil(maxAgeMs / 1000),
  };
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(ADMIN_COOKIE, token, cookieOpts(ADMIN_SESSION_TTL_MS));
}
export async function setPendingCookie(token: string): Promise<void> {
  (await cookies()).set(PENDING_COOKIE, token, cookieOpts(PENDING_TTL_MS));
}
export async function setReauthCookie(token: string): Promise<void> {
  (await cookies()).set(REAUTH_COOKIE, token, cookieOpts(REAUTH_TTL_MS));
}
export async function clearAdminCookies(): Promise<void> {
  const c = await cookies();
  for (const name of [ADMIN_COOKIE, PENDING_COOKIE, REAUTH_COOKIE]) {
    c.set(name, "", { httpOnly: true, path: "/", maxAge: 0 });
  }
}
