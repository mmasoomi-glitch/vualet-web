/**
 * THE WHATSAPP CONSENT RULE — ONE DEFINITION, THREE CALLERS.
 *
 * Release gate C1 (specs#160) originally demanded THREE ticked boxes before a
 * customer's WhatsApp number could be bound: unofficial automation, ban risk,
 * and replies from their own account. Revision r2 reduces that to ONE.
 *
 * WHY (consent-friction remediation, 2026-08-23):
 *   - The product's normal shape is now a PRIVATE SELF-CHAT. The customer
 *     messages themselves and the assistant replies from their own account.
 *     There is no group and no third party unless the customer turns group mode
 *     on. The old copy's "it runs inside a WhatsApp group you create" had become
 *     factually wrong, and a wrong disclosure is worse than a short one.
 *   - "Unofficial automation" and "ban risk" are two halves of ONE fact: using
 *     unofficial automation IS what creates the ban risk. The judge model
 *     (google/gemini-2.5-flash, request gen-1787492131-bFj1wgqjjyikuMA3lZbv)
 *     ruled that merging them into a single checkbox whose label states both
 *     "accurately reflects the causal link ... maintaining transparency and
 *     ensuring informed consent". That ruling is also why `banRisk` SURVIVES as
 *     the one required scope: the same judge REFUSED to demote it to prose.
 *   - `ownAccountReplies` is demoted to prose, not deleted. The judge's words:
 *     it "is a product feature, not a risk or consequence, and can be adequately
 *     disclosed in prose". It is still on the screen, above the box, unticked.
 *
 * NO RISK FACT WAS REMOVED FROM THE DISCLOSURE. Only the number of ticks
 * changed. Unticked prose on the same screen is still disclosure; a checkbox is
 * an affirmative acceptance of a CONSEQUENCE the customer personally bears, and
 * exactly one consequence here qualifies.
 *
 * Two specs#160 sentences WERE dropped as redundant, and only after the judge
 * ruled them so: "we recommend a secondary or dedicated number" (covered by
 * "do not connect a number you cannot afford to lose") and "you may decline any
 * part of this" (inherent in an unticked box). A third — "this is a real and
 * ongoing risk, not a one-time possibility" — the judge ordered RESTORED, and
 * it is back on the screen verbatim.
 *
 * BACKWARD COMPATIBILITY IS NOT OPTIONAL. Records written by the three-box era
 * carry all three scopes and disclosure "specs#160". They stay valid forever:
 * `readStoredConsent` accepts both revisions, and `readConsent` PRESERVES any
 * legacy scope a client still sends instead of discarding it.
 *
 * This module is deliberately PLAIN TypeScript with no imports at all: it has no
 * "use client" directive and touches no server-only API, so the React disclosure
 * component, /api/begin and /api/checkout can all import the same file. Adding a
 * required scope here changes every caller at once, and any caller that has not
 * kept up fails to compile.
 *
 * WHAT THIS MODULE IS NOT: it is not the disclosure copy. The words the customer
 * reads live on one screen, in the component. This module holds only the scope
 * names, which of them are required, and the predicates that decide whether
 * consent is complete.
 */

/** The only required consent scope is `banRisk`, which now covers both unofficial automation and the ban risk as a merged checkbox. */
export const REQUIRED_CONSENT_SCOPES = ["banRisk"] as const;

/** Union type of required consent scopes. */
export type RequiredConsentScope = (typeof REQUIRED_CONSENT_SCOPES)[number];

/** Legacy scopes that are no longer required but are still accepted and preserved so existing stored records remain valid. */
export const LEGACY_CONSENT_SCOPES = ["unofficialAutomation", "ownAccountReplies"] as const;

/** Union type of legacy consent scopes. */
export type LegacyConsentScope = (typeof LEGACY_CONSENT_SCOPES)[number];

/** Optional consent scopes remain unchanged. */
export const OPTIONAL_CONSENT_SCOPES = ["observationNumber"] as const;

/** Union type of optional consent scopes. */
export type OptionalConsentScope = (typeof OPTIONAL_CONSENT_SCOPES)[number];

/** Current consent disclosure version, updated to `specs#160r2` reflecting the merged banRisk box. */
export const CONSENT_DISCLOSURE = "specs#160r2";

/** All known consent disclosure versions, including the previous `specs#160` for backward compatibility. */
export const KNOWN_CONSENT_DISCLOSURES = ["specs#160", "specs#160r2"] as const;

/** Union type of known consent disclosure strings. */
export type ConsentDisclosure = (typeof KNOWN_CONSENT_DISCLOSURES)[number];

/** Consent record type: `banRisk` and `observationNumber` are required; `unofficialAutomation` and `ownAccountReplies` are optional legacy keys preserved for existing records. */
export type WhatsAppConsent = {
  banRisk: boolean;
  observationNumber: boolean;
  unofficialAutomation?: boolean;
  ownAccountReplies?: boolean;
};

/** Default empty consent record with only the required keys set to `false`. */
export const EMPTY_WHATSAPP_CONSENT: WhatsAppConsent = {
  banRisk: false,
  observationNumber: false,
};

/** Returns `true` if all required consent scopes are explicitly `true`. */
export function whatsAppConsentComplete(v: WhatsAppConsent): boolean {
  return REQUIRED_CONSENT_SCOPES.every((s) => v[s] === true);
}

export type StoredConsent = {
  banRisk: true;
  observationNumber: boolean;
  unofficialAutomation?: boolean;
  ownAccountReplies?: boolean;
  disclosure: ConsentDisclosure;
  acceptedAt: string;
};
export type ConsentFailure =
  | { ok: false; error: "consent_required"; missing: RequiredConsentScope[] }
  | { ok: false; error: "consent_invalid"; missing: [] };
export type ConsentResult = { ok: true; consent: StoredConsent } | ConsentFailure;

/**
 * Reads and validates a raw consent object. Strict `=== true` checks ensure that
 * only explicit boolean `true` values satisfy required scopes, preventing truthy
 * coercion (e.g., non-empty strings). Legacy scopes are preserved as optional
 * keys only when explicitly `true`, so that previously granted consents remain
 * recognizable without forcing all consumers to adopt the new required scope
 * model.
 */
export function readConsent(raw: unknown): ConsentResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "consent_required", missing: [...REQUIRED_CONSENT_SCOPES] };
  }

  const obj = raw as Record<string, unknown>;

  const missing = REQUIRED_CONSENT_SCOPES.filter((s) => obj[s] !== true);
  if (missing.length > 0) {
    return { ok: false, error: "consent_required", missing };
  }

  const obs = obj["observationNumber"];
  if (obs !== undefined && obs !== null && typeof obs !== "boolean") {
    return { ok: false, error: "consent_invalid", missing: [] };
  }

  for (const scope of LEGACY_CONSENT_SCOPES) {
    const val = obj[scope];
    if (val !== undefined && val !== null && typeof val !== "boolean") {
      return { ok: false, error: "consent_invalid", missing: [] };
    }
  }

  const consent: StoredConsent = {
    banRisk: true,
    observationNumber: obs === true,
    disclosure: CONSENT_DISCLOSURE,
    acceptedAt: new Date().toISOString(),
  };

  if (obj["unofficialAutomation"] === true) {
    consent.unofficialAutomation = true;
  }
  if (obj["ownAccountReplies"] === true) {
    consent.ownAccountReplies = true;
  }

  return { ok: true, consent };
}

/**
 * READ side for stored consent, deliberately separate from readConsent (which
 * validates fresh browser input). A record from the three-box era (disclosure
 * "specs#160", all three scopes true) stays valid forever.
 */
export function readStoredConsent(raw: unknown): StoredConsent | null {
  if (!isPlainObject(raw)) return null;
  if (raw.banRisk !== true) return null;

  const disclosure = raw.disclosure;
  if (typeof disclosure !== "string") return null;

  const knownDisclosures: readonly string[] = KNOWN_CONSENT_DISCLOSURES;
  if (!knownDisclosures.includes(disclosure)) return null;
  const consentDisclosure = disclosure as ConsentDisclosure;

  const acceptedAt = raw.acceptedAt;
  if (typeof acceptedAt !== "string") return null;

  const observationNumber: boolean = raw.observationNumber === true;

  const result: StoredConsent = {
    banRisk: true,
    observationNumber,
    disclosure: consentDisclosure,
    acceptedAt,
  };

  for (const scope of LEGACY_CONSENT_SCOPES) {
    if (raw[scope] === true) {
      result[scope] = true;
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── Refusal copy ──────────────────────────────────────────────────────────
// ONE rule, but not one sentence: the paid path is about to take money and the
// trial path is not, and telling a trial customer we are "about to take payment"
// would be a small lie told by a module whose entire job is honesty. Neither
// message restates the disclosure — that lives on one screen, not three.
// Singular "the box" since r2: there is exactly one required tick.

/** Consent prompt shown before payment. */
export const CONSENT_MESSAGE =
  "Please read the WhatsApp notice and tick the box before we take payment.";
/** Consent prompt shown before connecting a number (trial). */
export const CONSENT_MESSAGE_NO_PAYMENT =
  "Please read the WhatsApp notice and tick the box before we connect your number.";
/** Error shown when the consent form could not be read. */
export const CONSENT_INVALID_MESSAGE =
  "That consent form couldn't be read. Please tick the box again.";
