import { kvGet, kvSet, kvDel } from "@/lib/store";
import { randomId, hashPassword, verifyPassword, sha256Hex } from "@/lib/admin-crypto";
import { encryptSecret } from "@/lib/admin-crypto";
import type { AdminRole } from "@/lib/admin-roles";
import { isAdminRole } from "@/lib/admin-roles";

/**
 * PER-ADMIN IDENTITY STORE (backend-generalised §6/§7).
 *
 * Replaces the single shared ADMIN_PASSWORD with individual admin accounts,
 * each with its own credential, role set, scope, expiry and MFA seed. Backed by
 * the existing kv store. Because kv has no scan, we keep an explicit id index.
 *
 * Bootstrap: on first use, if no admins exist, an OWNER is seeded from
 * ADMIN_OWNER_EMAIL + (ADMIN_OWNER_PASSWORD || legacy ADMIN_PASSWORD). That
 * owner must enrol MFA on first login. If neither is set, the store is simply
 * empty and login is unavailable until an owner is seeded — the address is not
 * the security.
 */

export type AdminStatus = "invited" | "active" | "suspended";

export type AdminAccount = {
  id: string;
  email: string;
  roles: AdminRole[];
  scope?: string; // optional tenant/area scope note (§7)
  status: AdminStatus;
  passwordHash?: string; // set on invite-accept / bootstrap
  mfaSecretEnc?: string; // AES-GCM encrypted TOTP seed; absent until enrolled
  mfaEnrolled: boolean;
  inviteTokenHash?: string; // sha256 of the invite token (invited state only)
  inviteExpires?: number; // epoch ms
  createdAt: string;
  createdBy?: string; // admin id of the inviter
  expiresAt?: number; // epoch ms — access auto-denied past this (§7)
  lastLoginAt?: string;
};

const acctKey = (id: string) => `mira:admin:acct:${id}`;
const emailIdxKey = (email: string) => `mira:admin:acct:byemail:${email.toLowerCase()}`;
const INDEX_KEY = "mira:admin:acct:index";

async function indexIds(): Promise<string[]> {
  return (await kvGet<string[]>(INDEX_KEY)) ?? [];
}

async function addToIndex(id: string): Promise<void> {
  const ids = await indexIds();
  if (!ids.includes(id)) {
    ids.push(id);
    await kvSet(INDEX_KEY, ids);
  }
}

async function removeFromIndex(id: string): Promise<void> {
  const ids = (await indexIds()).filter((x) => x !== id);
  await kvSet(INDEX_KEY, ids);
}

export async function getAdmin(id: string): Promise<AdminAccount | null> {
  return kvGet<AdminAccount>(acctKey(id));
}

export async function getAdminByEmail(email: string): Promise<AdminAccount | null> {
  const id = await kvGet<string>(emailIdxKey(email));
  return id ? getAdmin(id) : null;
}

export async function listAdmins(): Promise<AdminAccount[]> {
  const ids = await indexIds();
  const out: AdminAccount[] = [];
  for (const id of ids) {
    const a = await getAdmin(id);
    if (a) out.push(a);
  }
  return out;
}

async function save(acct: AdminAccount): Promise<void> {
  await kvSet(acctKey(acct.id), acct);
  await kvSet(emailIdxKey(acct.email), acct.id);
  await addToIndex(acct.id);
}

export async function updateAdmin(id: string, patch: Partial<AdminAccount>): Promise<AdminAccount | null> {
  const cur = await getAdmin(id);
  if (!cur) return null;
  const next: AdminAccount = { ...cur, ...patch, id: cur.id, email: patch.email?.toLowerCase() ?? cur.email };
  await save(next);
  return next;
}

export async function removeAdmin(id: string): Promise<void> {
  const cur = await getAdmin(id);
  await kvDel(acctKey(id));
  if (cur) await kvDel(emailIdxKey(cur.email));
  await removeFromIndex(id);
}

/** Create an INVITED admin. Returns the account + the one-time invite token. */
export async function createInvite(params: {
  email: string;
  roles: AdminRole[];
  scope?: string;
  expiresAt?: number;
  createdBy: string;
  inviteTtlMs?: number;
}): Promise<{ account: AdminAccount; inviteToken: string }> {
  const roles = params.roles.filter(isAdminRole);
  const inviteToken = randomId("inv", 24);
  const account: AdminAccount = {
    id: randomId("adm"),
    email: params.email.toLowerCase(),
    roles,
    scope: params.scope,
    status: "invited",
    mfaEnrolled: false,
    inviteTokenHash: sha256Hex(inviteToken),
    inviteExpires: Date.now() + (params.inviteTtlMs ?? 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date().toISOString(),
    createdBy: params.createdBy,
    expiresAt: params.expiresAt,
  };
  await save(account);
  return { account, inviteToken };
}

/** Accept an invite: set a password, move to active. MFA enrolment follows at login. */
export async function acceptInvite(email: string, token: string, password: string): Promise<AdminAccount | null> {
  const acct = await getAdminByEmail(email);
  if (!acct || acct.status !== "invited" || !acct.inviteTokenHash) return null;
  if (acct.inviteExpires && acct.inviteExpires < Date.now()) return null;
  if (sha256Hex(token) !== acct.inviteTokenHash) return null;
  return updateAdmin(acct.id, {
    status: "active",
    passwordHash: hashPassword(password),
    inviteTokenHash: undefined,
    inviteExpires: undefined,
  });
}

export function isExpired(a: AdminAccount): boolean {
  return Boolean(a.expiresAt && a.expiresAt < Date.now());
}

export function isUsable(a: AdminAccount): boolean {
  return a.status === "active" && !isExpired(a);
}

export function verifyAdminPassword(a: AdminAccount, password: string): boolean {
  return verifyPassword(password, a.passwordHash);
}

/** Persist an enrolled (encrypted) TOTP seed and flip the enrolled flag. */
export async function setMfaSecret(id: string, secretPlain: string): Promise<AdminAccount | null> {
  return updateAdmin(id, { mfaSecretEnc: encryptSecret(secretPlain), mfaEnrolled: true });
}

/**
 * Ensure at least one owner exists. Idempotent; safe to call at the start of
 * any admin request. Seeds from env only when the store is empty.
 */
export async function ensureOwnerBootstrap(): Promise<void> {
  const ids = await indexIds();
  if (ids.length > 0) return;
  const email = process.env.ADMIN_OWNER_EMAIL;
  const password = process.env.ADMIN_OWNER_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!email || !password) return; // nothing to seed; login stays unavailable
  const account: AdminAccount = {
    id: randomId("adm"),
    email: email.toLowerCase(),
    roles: ["owner"],
    status: "active",
    passwordHash: hashPassword(password),
    mfaEnrolled: false, // must enrol MFA on first login
    createdAt: new Date().toISOString(),
  };
  await save(account);
}

/** Public-safe projection (never leaks hashes / encrypted seeds). */
export type AdminPublic = {
  id: string;
  email: string;
  roles: AdminRole[];
  scope?: string;
  status: AdminStatus;
  mfaEnrolled: boolean;
  createdAt: string;
  createdBy?: string;
  expiresAt?: number;
  lastLoginAt?: string;
};

export function toPublic(a: AdminAccount): AdminPublic {
  return {
    id: a.id,
    email: a.email,
    roles: a.roles,
    scope: a.scope,
    status: a.status,
    mfaEnrolled: a.mfaEnrolled,
    createdAt: a.createdAt,
    createdBy: a.createdBy,
    expiresAt: a.expiresAt,
    lastLoginAt: a.lastLoginAt,
  };
}
