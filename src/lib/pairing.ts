/**
 * WHERE A CUSTOMER GOES TO PAIR — ONE SOURCE OF TRUTH.
 *
 * Two routes hand a customer their pairing link: /api/begin mints it at signup,
 * /api/connect re-reads it on the welcome page. They MUST produce byte-identical
 * URLs — if they drift, a customer who reloads the welcome page gets a different
 * link from the one they were first given. So the rule lives here, once, and
 * neither route is allowed its own copy.
 *
 * This module deliberately builds NOTHING for Telegram: the Telegram deep-link
 * is a stable public t.me URL that needs no configuration, and it stays where it
 * already is.
 */

/** The channels a connect record can be paired on. */
export type Channel = "whatsapp" | "telegram";

export const CHANNELS: readonly Channel[] = ["whatsapp", "telegram"];

/**
 * What a NEW signup gets when the client names no channel.
 *
 * decisions#340 (option A): signup is WhatsApp-first and Telegram is not offered
 * to new customers, so silence at signup means WhatsApp.
 */
export const DEFAULT_SIGNUP_CHANNEL: Channel = "whatsapp";

/**
 * What an EXISTING record means when it carries no channel.
 *
 * NOTE THE ASYMMETRY, IT IS INTENTIONAL. A missing channel on the way IN means
 * WhatsApp (above); a missing channel on the way OUT means Telegram. They are
 * not the same question. Every record written before the channel field existed
 * was a Telegram signup, and there is no other way to read one — guessing
 * WhatsApp for those customers would strand them on a channel they never chose
 * and were never paired on.
 */
export function channelOfRecord(rec: { channel?: Channel } | null | undefined): Channel {
  return rec?.channel ?? "telegram";
}

/**
 * Where the WhatsApp pairing surface lives. Server-only (no NEXT_PUBLIC_
 * prefix) because the browser never needs it — it receives the finished URL.
 *
 * There is deliberately NO WhatsApp pairing route in this repo: the pairing
 * machinery lives in the Ballerina engine and its public surface is currently
 * closed (decisions#293 retracted it; reopening is gated on C1/C11). So nothing
 * here invents an endpoint — it composes a link onto a base URL the owner
 * configures WHEN the surface is genuinely reopened, and returns null until then.
 *
 * Set it to the full public pairing URL, e.g.
 *   MIRA_WHATSAPP_PAIR_BASE=https://api.vualet.com/wa/pair
 * The connect token is appended as a `token` query parameter, so a base that
 * already carries query parameters is preserved.
 */
export const PAIR_BASE_ENV = "MIRA_WHATSAPP_PAIR_BASE";

/**
 * The WhatsApp pairing URL for a token, or null if we cannot build one we
 * believe in. Callers decide what null means for them — /api/begin refuses to
 * provision at all, /api/connect returns the record with no link — but NEITHER
 * is allowed to substitute a guess.
 */
export function whatsappPairUrl(token: string): string | null {
  const base = (process.env[PAIR_BASE_ENV] ?? "").trim();
  if (!base) return null;
  try {
    const url = new URL(base);
    url.searchParams.set("token", token);
    return url.toString();
  } catch {
    // A misconfigured base is the same failure as an absent one: we will not
    // hand a customer a link we cannot prove is a URL.
    return null;
  }
}
