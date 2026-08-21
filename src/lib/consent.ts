/**
 * THE WHATSAPP CONSENT RULE — ONE DEFINITION, THREE CALLERS.
 *
 * Release gate C1 (specs#160) requires that before a customer's WhatsApp number
 * is bound, they are shown — and agree to — three things: that this is
 * unofficial automation, that the number they connect carries a ban/restriction
 * risk, and that replies may appear to come from their own account.
 *
 * That rule was written down three times: once in the disclosure component the
 * customer ticks, once in /api/checkout, and once (not at all, which is worse)
 * in /api/begin. Three copies of a consent rule is three chances for the boxes a
 * customer ticks to stop matching the boxes a server insists on — and the failure
 * mode is silent: the wizard would go green while the server recorded nothing, or
 * the server would refuse a form the customer had genuinely completed.
 *
 * So it lives here, once. This module is deliberately PLAIN TypeScript with no
 * imports at all: it has no "use client" directive and touches no server-only
 * API, so the React disclosure component, /api/begin and /api/checkout can all
 * import the same file. Adding a required scope here changes every caller at
 * once, and any caller that has not kept up fails to compile.
 *
 * WHAT THIS MODULE IS NOT: it is not the disclosure copy. The words the customer
 * reads live on one screen, in the component. This module holds only the scope
 * names, which of them are required, and the two predicates — one for the
 * browser, one for the server — that decide whether consent is complete.
 */

/**
 * The scopes a customer MUST accept before a number may be bound. Adding one
 * here is a breaking change on purpose: every caller re-checks against this list.
 */
export const REQUIRED_CONSENT_SCOPES = [
  "unofficialAutomation",
  "banRisk",
  "ownAccountReplies",
] as const;

export type RequiredConsentScope = (typeof REQUIRED_CONSENT_SCOPES)[number];

/**
 * Opt-IN extras. Absent means "not added" — never "assume yes". These are
 * recorded but never gate anything, so a customer who declines them still
 * completes signup.
 */
export const OPTIONAL_CONSENT_SCOPES = ["observationNumber"] as const;

export type OptionalConsentScope = (typeof OPTIONAL_CONSENT_SCOPES)[number];

/** The disclosure revision these boxes belong to, stamped onto what we store so
 *  "what were they actually shown?" stays answerable after the copy changes. */
export const CONSENT_DISCLOSURE = "specs#160";

/** The consent form as the browser holds it while the customer is ticking. */
export type WhatsAppConsent = Record<RequiredConsentScope | OptionalConsentScope, boolean>;

/** Every box unticked. The only honest starting state: nothing is pre-agreed. */
export const EMPTY_WHATSAPP_CONSENT: WhatsAppConsent = {
  unofficialAutomation: false,
  banRisk: false,
  ownAccountReplies: false,
  observationNumber: false,
};

/**
 * BROWSER-SIDE predicate: may the customer proceed? Used to enable the submit
 * button. Strict `=== true` for the same reason the server is strict — the two
 * must agree, or the wizard offers a button the server will refuse.
 */
export function whatsAppConsentComplete(v: WhatsAppConsent): boolean {
  return REQUIRED_CONSENT_SCOPES.every((scope) => v[scope] === true);
}

/**
 * What lands on the connect record: the ticked boxes plus when, and against
 * which disclosure text, so "what were they shown, and when did they agree?"
 * is answerable later. The required scopes are typed as literal `true` because
 * a stored consent that is anything else is not a consent.
 */
export type StoredConsent = {
  unofficialAutomation: true;
  banRisk: true;
  ownAccountReplies: true;
  observationNumber: boolean;
  /** The approved disclosure copy these boxes belong to. */
  disclosure: typeof CONSENT_DISCLOSURE;
  acceptedAt: string;
};

export type ConsentFailure =
  | { ok: false; error: "consent_required"; missing: RequiredConsentScope[] }
  | { ok: false; error: "consent_invalid"; missing: [] };

export type ConsentResult = { ok: true; consent: StoredConsent } | ConsentFailure;

/**
 * SERVER-SIDE validator for a client-supplied consent object.
 *
 * Strictly `=== true` per scope: a truthy "yes", a 1 or a non-empty string is a
 * client bug, and a bug must never be read as informed agreement to a ban risk.
 * This is the check that actually matters — the browser can be walked around,
 * so every path that binds a number calls this before it binds anything.
 */
export function readConsent(raw: unknown): ConsentResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "consent_required", missing: [...REQUIRED_CONSENT_SCOPES] };
  }
  const given = raw as Record<string, unknown>;

  const missing = REQUIRED_CONSENT_SCOPES.filter((scope) => given[scope] !== true);
  if (missing.length > 0) return { ok: false, error: "consent_required", missing };

  // Optional scope: absent means "not added". A non-boolean is refused rather
  // than coerced, so a broken client is visible instead of silently deciding
  // this for the customer in either direction.
  const obs = given.observationNumber;
  if (obs !== undefined && obs !== null && typeof obs !== "boolean") {
    return { ok: false, error: "consent_invalid", missing: [] };
  }

  return {
    ok: true,
    consent: {
      unofficialAutomation: true,
      banRisk: true,
      ownAccountReplies: true,
      observationNumber: obs === true,
      disclosure: CONSENT_DISCLOSURE,
      acceptedAt: new Date().toISOString(),
    },
  };
}

// ── Refusal copy ──────────────────────────────────────────────────────────
// ONE rule, but not one sentence: the paid path is about to take money and the
// trial path is not, and telling a trial customer we are "about to take payment"
// would be a small lie told by a module whose entire job is honesty. Neither
// message restates the disclosure — that lives on one screen, not three.

/** Missing required boxes on a path that is about to charge. */
export const CONSENT_MESSAGE =
  "Please read the WhatsApp notice and tick the three required boxes before we take payment.";

/** Missing required boxes on a path that takes no payment (the free trial). */
export const CONSENT_MESSAGE_NO_PAYMENT =
  "Please read the WhatsApp notice and tick the three required boxes before we connect your number.";

/** The object came through unreadable — a client bug, not a customer decision. */
export const CONSENT_INVALID_MESSAGE =
  "That consent form couldn't be read. Please tick the boxes again.";
