/**
 * E.164 PHONE NORMALISATION — VENDORED, NOT RE-DERIVED.
 *
 * Source of truth: C:\Ballerina-Motasadea-V1\apps\engine\src\telegram-commands.mjs
 * (function `normalisePhone`, lines 108-130). That engine copy is THE ORIGINAL and stays
 * the original; this file is a faithful TypeScript port of it, character-for-character in
 * behaviour. It is vendored rather than imported because vualet-web and the Ballerina engine
 * are two separate repositories that share no npm package — there is no import path between
 * them. If the engine's rules ever change, change them THERE first and re-port here.
 *
 * The contract is deliberately identical to the engine's so that a number typed into the web
 * wizard and a number shared through the engine converge on exactly one canonical identity.
 */

/** A number that normalised cleanly. `e164` is `+` followed by 8..15 digits. */
export type PhoneOk = { ok: true; e164: string };

/** Every reason code, in one place. The type below is derived from it so the two cannot drift. */
export const PHONE_REASONS = ["empty", "no-digits", "leading-zero", "length"] as const;

/** Why a number was refused. These codes are stable and safe to switch on in the UI. */
export type PhoneReason = (typeof PHONE_REASONS)[number];

/**
 * Narrow an untrusted value (e.g. a `reason` field parsed from an API response) to a known
 * reason code. Anything unrecognised is not a reason we can explain, so it is not one we claim.
 */
export function isPhoneReason(v: unknown): v is PhoneReason {
  return typeof v === "string" && (PHONE_REASONS as readonly string[]).includes(v);
}

/** A number that could not be normalised. Nothing is stored when this is returned. */
export type PhoneFail = { ok: false; reason: PhoneReason };

export type PhoneResult = PhoneOk | PhoneFail;

export type NormalisePhoneOptions = {
  /**
   * Injected, never read from env. Only used for national forms.
   * Defaults to {@link DEFAULT_CALLING_CODE}.
   */
  defaultCallingCode?: string;
};

/**
 * THE calling code assumed for a number typed without one (e.g. "050 123 4567" -> UAE).
 *
 * This is the ONE definition. It is exported so that every caller — the signup wizard, checkout,
 * the /api/begin route — applies the same assumption as normalisePhone's own default, instead of
 * each keeping a private "971" that can drift without any test noticing. Import it; do not retype
 * the digits. It is a module constant, deliberately NOT an env read: the same input must normalise
 * to the same identity on every machine, in every environment, forever.
 */
export const DEFAULT_CALLING_CODE = "971";

/**
 * Normalise a phone number to E.164 (`+` followed by 8..15 digits).
 *
 * Accepts the forms real people and Telegram actually produce:
 *   +971 50 123 4567 · 00971501234567 · 971501234567 · 0501234567 · 501234567 · (050) 123-4567
 *
 * `defaultCallingCode` is INJECTED (never read from env). It only kicks in for national forms —
 * a leading `+` or `00` always wins, so an international number is never mangled. A national
 * trunk-prefix number from another country ("07911…" in the UK with a 971 default) is inherently
 * ambiguous and will resolve to the default country; that is the known, documented limit of
 * normalising without a country hint. Telegram's own contact.phone_number is always international,
 * so this only matters for hand-typed input.
 */
export function normalisePhone(
  raw: unknown,
  { defaultCallingCode = DEFAULT_CALLING_CODE }: NormalisePhoneOptions = {},
): PhoneResult {
  if (raw == null) return { ok: false, reason: "empty" };
  const s = String(raw).trim();
  if (!s) return { ok: false, reason: "empty" };

  const hadPlus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (!digits) return { ok: false, reason: "no-digits" };

  const cc = String(defaultCallingCode || "").replace(/\D/g, "");

  let intl: string;
  if (digits.startsWith("00")) intl = digits.slice(2);                       // 00-prefixed international
  else if (hadPlus) intl = digits;                                           // already international
  else if (cc && digits.startsWith(cc) && digits.length > cc.length + 5) intl = digits;
  else if (digits.startsWith("0")) intl = cc + digits.replace(/^0+/, "");    // national trunk form
  else if (digits.length >= 10) intl = digits;                               // long enough to carry a CC
  else intl = cc + digits;                                                   // short local form

  if (!intl || /^0/.test(intl)) return { ok: false, reason: "leading-zero" };
  if (intl.length < 8 || intl.length > 15) return { ok: false, reason: "length" };
  return { ok: true, e164: `+${intl}` };
}

/**
 * Human-readable text for each refusal reason, for inline form errors.
 * Kept next to the reason codes so a new code can never ship without a message.
 */
export const PHONE_ERROR_TEXT: Record<PhoneReason, string> = {
  "empty": "Please enter your WhatsApp number.",
  "no-digits": "That doesn't look like a phone number — digits only, please.",
  "leading-zero": "That number can't be read as an international number. Try it with your country code, like +971 50 123 4567.",
  "length": "That number is the wrong length. Check the digits and try again.",
};

/** Convenience: the message to show for a failed result. */
export function phoneErrorText(reason: PhoneReason): string {
  return PHONE_ERROR_TEXT[reason] ?? PHONE_ERROR_TEXT["length"];
}
