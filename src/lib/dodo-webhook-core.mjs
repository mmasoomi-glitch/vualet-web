/**
 * DODO WEBHOOK CORE — pure, env-free verification + activation for Dodo events.
 *
 * Dodo follows the Standard Webhooks spec (docs.dodopayments.com/developer-resources/webhooks):
 *   headers:  webhook-id, webhook-timestamp, webhook-signature
 *   signed:   `${id}.${timestamp}.${rawBody}`
 *   sig:      base64(HMAC-SHA256(signedContent, secretBytes)), presented in the
 *             webhook-signature header as a space-separated list of `v1,<b64>`.
 *   secret:   Standard-Webhooks secrets are usually `whsec_<base64>`; the bytes
 *             used for HMAC are base64-decode(secret-without-whsec_-prefix).
 *
 * Kept pure (crypto injected) so scripts/dodo-webhook-test.mjs exercises the
 * EXACT verification + tier-activation code the route runs — mirrors
 * webhook-core.mjs. No env reads, no network.
 *
 * @typedef {import("./store").ConnectRecord} ConnectRecord
 */

/**
 * Decode a Standard-Webhooks secret to the raw HMAC key bytes.
 * @param {string} secret
 * @returns {Buffer}
 */
export function secretKeyBytes(BufferCtor, secret) {
  const b64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return BufferCtor.from(b64, "base64");
}

/**
 * Constant-time-ish check that a computed base64 signature appears in the
 * space-separated `v1,<sig>` list from the webhook-signature header.
 * @param {string} header  raw webhook-signature header value
 * @param {string} expectedB64  our computed base64 signature
 * @param {(a: string, b: string) => boolean} safeEqual  timing-safe string compare
 * @returns {boolean}
 */
export function signatureMatches(header, expectedB64, safeEqual) {
  if (!header) return false;
  for (const part of header.split(" ")) {
    const comma = part.indexOf(",");
    const sig = comma === -1 ? part : part.slice(comma + 1);
    if (sig && safeEqual(sig, expectedB64)) return true;
  }
  return false;
}

/**
 * Verify a Standard-Webhooks delivery. All crypto injected.
 * @param {{ id: string, timestamp: string, signatureHeader: string, rawBody: string, secret: string }} d
 * @param {{
 *   createHmac: (alg: string, key: any) => any,
 *   Buffer: any,
 *   safeEqual: (a: string, b: string) => boolean,
 *   now?: number,
 *   toleranceSeconds?: number,
 * }} crypto
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifyDodoWebhook(d, crypto) {
  const { id, timestamp, signatureHeader, rawBody, secret } = d;
  const { createHmac, Buffer, safeEqual } = crypto;
  if (!id || !timestamp || !signatureHeader) return { ok: false, reason: "missing_headers" };
  if (!secret) return { ok: false, reason: "no_secret" };

  // Optional replay guard: reject timestamps outside tolerance (default 5 min).
  const tol = crypto.toleranceSeconds ?? 300;
  const now = crypto.now ?? Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > tol) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  const signed = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secretKeyBytes(Buffer, secret)).update(signed).digest("base64");
  return signatureMatches(signatureHeader, expected, safeEqual)
    ? { ok: true }
    : { ok: false, reason: "bad_signature" };
}

/**
 * Build an ACTIVATED connect/subscription record from a Dodo subscription-active
 * (or payment-succeeded) event payload. Tier decision mirrors the Stripe core:
 *   plan = base.plan (set at checkout) ?? payload.metadata.plan ?? "companion".
 * NEVER gates on amount — a $0 / 100%-off order activates like a paid one.
 *
 * @param {any} payload  parsed Dodo event `data` object
 * @param {ConnectRecord | null | undefined} base  existing connect record, if any
 * @param {string} now  ISO timestamp for createdAt when there is no base
 * @returns {ConnectRecord}
 */
export function activationRecordFromDodo(payload, base, now) {
  const meta = payload?.metadata ?? {};
  const token = meta.connect_token || undefined;
  const customerId = payload?.customer?.customer_id ?? payload?.customer_id ?? undefined;
  const subscriptionId = payload?.subscription_id ?? undefined;
  return /** @type {ConnectRecord} */ ({
    token: token ?? subscriptionId ?? customerId ?? "unknown",
    plan: base?.plan ?? meta.plan ?? "companion",
    email: base?.email ?? payload?.customer?.email ?? undefined,
    status: "active",
    customerId,
    subscriptionId,
    telegramId: base?.telegramId,
    persona: base?.persona,
    role: base?.role,
    assistantName: base?.assistantName,
    createdAt: base?.createdAt ?? now,
  });
}

/**
 * Activate from a Dodo event: read any base connect record (by metadata token),
 * build the active record, write it to connect + subscription stores. I/O injected.
 * @param {any} payload
 * @param {{
 *   getConnect: (t: string) => Promise<ConnectRecord | null>,
 *   putConnect: (r: ConnectRecord) => Promise<void>,
 *   putSubscription: (c: string, r: ConnectRecord) => Promise<void>,
 *   now?: string,
 * }} deps
 * @returns {Promise<ConnectRecord>}
 */
export async function activateDodo(payload, deps) {
  const { getConnect, putConnect, putSubscription, now } = deps;
  const token = payload?.metadata?.connect_token || undefined;
  const base = token ? await getConnect(token) : null;
  const rec = activationRecordFromDodo(payload, base, now ?? new Date().toISOString());
  if (token) await putConnect(rec);
  if (rec.customerId) await putSubscription(rec.customerId, rec);
  return rec;
}
