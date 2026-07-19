/**
 * PRIVACY CONTRACT (backend-generalised §1) — the single source of truth for
 * what an admin may and may NOT see about a customer.
 *
 * NO admin role — not even owner — may read customer conversation / message /
 * memory / document / prompt / output content. Admin surfaces expose OPERATIONAL
 * METADATA ONLY. This module is the whitelist the admin customer serializer is
 * built from, plus the blacklist the privacy test asserts against. It is
 * intentionally dependency-free so the runnable privacy test can import it.
 */

/** The ONLY customer fields any admin surface is allowed to project. */
export const ADMIN_CUSTOMER_METADATA_FIELDS = [
  "id",
  "name",
  "email",
  "plan",
  "channel",
  "status",
  "creditsUsed",
  "creditsIncluded",
  "mrrUsd",
  "joined",
  "country",
] as const;

/**
 * Field names that represent CUSTOMER CONTENT. If any of these ever appears in
 * an admin response shape, the privacy test fails the build. Also the names of
 * the content-bearing modules no admin route may import.
 */
export const FORBIDDEN_CONTENT_FIELDS = [
  "message",
  "messages",
  "messageBody",
  "conversation",
  "conversations",
  "conversationBody",
  "transcript",
  "transcripts",
  "prompt",
  "prompts",
  "completion",
  "output",
  "memory",
  "memories",
  "document",
  "documents",
  "docContent",
  "voiceNote",
  "attachmentBody",
  "kbContent",
  "modelContext",
  "apiKey",
  "accessToken",
  "secret",
] as const;

/** Content-bearing source modules that must never be imported by an admin route. */
export const FORBIDDEN_CONTENT_MODULES = ["veridian-memory", "veridian-kb"] as const;

export type AdminCustomerMetadata = {
  id: string;
  name: string;
  email: string;
  plan: string;
  channel: string;
  status: string;
  creditsUsed: number;
  creditsIncluded: number;
  mrrUsd: number;
  joined: string;
  country: string;
};

/**
 * Project an arbitrary customer record down to admin-visible metadata by
 * EXPLICIT allowlist. Never spread the source object — anything not on the
 * allowlist (including any accidental content field) is dropped here.
 */
export function toAdminCustomerMetadata(full: Record<string, unknown>): AdminCustomerMetadata {
  const out: Record<string, unknown> = {};
  for (const key of ADMIN_CUSTOMER_METADATA_FIELDS) {
    out[key] = full[key];
  }
  return out as AdminCustomerMetadata;
}

/** Runtime guard: throws if a would-be admin payload carries a forbidden field. */
export function assertNoForbiddenFields(obj: Record<string, unknown>, where = "admin payload"): void {
  for (const f of FORBIDDEN_CONTENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(obj, f)) {
      throw new Error(`Privacy violation: forbidden content field "${f}" present in ${where}`);
    }
  }
}
