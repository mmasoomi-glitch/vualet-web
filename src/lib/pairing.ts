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
 * THERE IS NOW A PAIRING ENTRY ROUTE IN THIS REPO, AND THAT IS WHAT THIS
 * VARIABLE POINTS AT [decisions#345].
 *
 * This comment used to say the opposite — "there is deliberately NO WhatsApp
 * pairing route in this repo" — and the consequence was that nothing correct
 * could be put in this variable, so `whatsappPairUrl` returned null, so
 * `/api/begin` refused every WhatsApp signup with 503 whatsapp_unavailable.
 * The product could not take a customer. The ruling placed the entry point
 * HERE rather than on the engine gateway, for three reasons that all point the
 * same way: this app minted the token and is the only side holding
 * MIRA_TOKEN_SECRET to verify it; this app is behind Cloudflare with a working
 * real_ip, so it is the only side that can see the customer's genuine address;
 * and this app can reach the gateway server-to-server over the existing
 * tunnel. Only the QR page itself has to reach the customer's browser, and
 * nginx proxies that (docs/nginx-pair-proxy.conf).
 *
 * ── THE VALUE AN OPERATOR MUST SET, EXACTLY ───────────────────────────────
 *
 *     MIRA_WHATSAPP_PAIR_BASE=https://mira.vualet.com/api/pair/start
 *
 * The host is `mira.vualet.com` and NOT `api.mira.vualet.com`: the latter is a
 * two-level subdomain outside Cloudflare's `*.vualet.com` universal
 * certificate, so its TLS handshake fails at the edge (verified 2026-08-15,
 * WA_V2_RUNBOOK). The path is the route in src/app/api/pair/start/route.ts.
 *
 * Two other variables must be set for that route to work, and it fails
 * honestly rather than half-working if they are not:
 *     WA_PROVISION_SECRET   the SAME string the gateway holds (it 401s otherwise)
 *     MIRA_ENGINE_URL       only if the wa-tunnel forwards a port other than
 *                           the default http://127.0.0.1:8790
 *
 * The connect token is appended as a `token` query parameter, so a base that
 * already carries query parameters is preserved.
 *
 * UNSET STILL MEANS NULL, AND /api/begin STILL REFUSES. That behaviour is not
 * weakened by any of the above and must not be: an unconfigured deployment
 * handing out links to a route whose downstream secret is missing would be the
 * dead link this whole module exists to prevent. It simply becomes unreachable
 * once the variable is set.
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
