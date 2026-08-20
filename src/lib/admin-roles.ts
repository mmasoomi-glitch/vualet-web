/**
 * ADMIN ROLE MATRIX (backend-generalised §6) — permissions, not `admin=true`.
 *
 * Every admin holds one or more ROLES. Every privileged route resolves the
 * caller's roles and checks a specific PERMISSION before acting. Dangerous
 * privileges are never auto-bundled: e.g. `owner` alone can manage admins;
 * `billing` can issue refunds but cannot touch identity.
 *
 * ABSOLUTE PRIVACY RULE (§1): there is deliberately NO permission anywhere in
 * this file that grants access to customer conversation / message / memory /
 * document CONTENT. No role can be granted it because it does not exist. Admin
 * data is metadata only (see admin-privacy-contract).
 */

export const ADMIN_ROLES = ["owner", "security", "ops", "billing", "support", "auditor"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ROLE_LABELS: Record<AdminRole, string> = {
  owner: "Owner / Super Admin",
  security: "Security Admin",
  ops: "Operations Admin",
  billing: "Billing Admin",
  support: "Support Agent",
  auditor: "Auditor",
};

export const ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  owner: "Manage admins & roles, configure plans/providers, full health & audit. Cannot read customer content.",
  security: "Auth/security events, revoke sessions, access policy, metadata incident review. No content.",
  ops: "Service health, queues, jobs, deployments, provider availability. No content.",
  billing: "Subscriptions, invoices, payment state, refunds, entitlements. No conversations/memories.",
  support: "Account status, plan, delivery errors, customer-provided excerpts only. No browsing conversations.",
  auditor: "Read-only: security events, admin actions, audit trail, compliance evidence. No content.",
};

/** The complete permission vocabulary. Note the total absence of any `content.*`. */
export type Permission =
  | "admin.read" // list admins & their status
  | "admin.invite" // invite a new admin
  | "admin.role.assign" // assign/revoke roles, scope, expiry, suspend
  | "admin.remove" // remove an admin
  | "audit.read" // read the append-only audit trail
  | "security.events.read" // auth/security events
  | "sessions.read.any" // view any admin's active sessions
  | "sessions.revoke.any" // revoke any admin's sessions
  | "health.read" // health dashboard / provider status
  | "customers.read" // customer METADATA (status/plan/usage/timestamps) — never content
  | "billing.read" // subscriptions / invoices / payment state
  | "billing.refund" // issue refunds
  | "providers.config" // configure AI/voice/payment providers
  | "plans.config"; // configure plans / entitlements

const OWNER_ALL: Permission[] = [
  "admin.read", "admin.invite", "admin.role.assign", "admin.remove",
  "audit.read", "security.events.read", "sessions.read.any", "sessions.revoke.any",
  "health.read", "customers.read", "billing.read", "billing.refund",
  "providers.config", "plans.config",
];

export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  owner: OWNER_ALL,
  security: ["security.events.read", "sessions.read.any", "sessions.revoke.any", "audit.read", "admin.read", "health.read", "customers.read"],
  ops: ["health.read", "providers.config", "customers.read"],
  billing: ["billing.read", "billing.refund", "customers.read"],
  support: ["customers.read"],
  auditor: ["audit.read", "security.events.read", "admin.read", "health.read"],
};

/** Dangerous actions that additionally require a fresh MFA reauth (§5). */
export const REAUTH_REQUIRED: Permission[] = [
  "admin.invite", "admin.role.assign", "admin.remove",
  "sessions.revoke.any", "billing.refund", "providers.config", "plans.config",
];

export function isAdminRole(x: unknown): x is AdminRole {
  return typeof x === "string" && (ADMIN_ROLES as readonly string[]).includes(x);
}

/** True if ANY of the caller's roles grants the permission. */
export function can(roles: readonly string[] | undefined, permission: Permission): boolean {
  if (!roles) return false;
  return roles.some((r) => isAdminRole(r) && ROLE_PERMISSIONS[r].includes(permission));
}

export function permissionsFor(roles: readonly string[]): Permission[] {
  const set = new Set<Permission>();
  for (const r of roles) if (isAdminRole(r)) for (const p of ROLE_PERMISSIONS[r]) set.add(p);
  return [...set];
}

export function needsReauth(permission: Permission): boolean {
  return REAUTH_REQUIRED.includes(permission);
}
