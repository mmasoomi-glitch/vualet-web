/**
 * THE WHATSAPP SINGLE-USE CLAIM — the WhatsApp-shaped twin of claimConnect().
 *
 * ── WHY THIS IS A SEPARATE FUNCTION IN A SEPARATE FILE ────────────────────
 * `claimConnect(token, telegramId: number)` cannot express a WhatsApp claim.
 * Its entire single-use invariant is `rec.telegramId`: that one number is both
 * the "already claimed" state AND the "claimed by someone else" test. Three
 * repairs were considered and two were rejected:
 *
 *   REJECTED — widen telegramId to also hold a JID. It is typed `number`, and
 *   claimConnect, mirrorIdentityToSubscription, POST /api/connect and
 *   engine-push all read it as a Telegram chat id. A JID sitting there would
 *   silently corrupt uniqueness on the channel that currently works.
 *
 *   REJECTED — generalise claimConnect into a two-channel function. Every edit
 *   to that function is an edit to the live Telegram bind path, and the whole
 *   point of this change is that the Telegram path must come out BYTE-
 *   IDENTICAL. scripts/pair-entry-test.mjs asserts exactly that against git.
 *
 *   CHOSEN — a parallel predicate, additive, in its own file. store.ts gains
 *   two optional fields and nothing else; claimConnect is not touched.
 *
 * ── WHEN THIS FIRES [decisions#345 Q_C] ───────────────────────────────────
 * ON SUCCESSFUL BIND. NOT when a token is presented at the pairing entry point,
 * and NOT when a QR is scanned. Presenting a token is a READ — that is what
 * makes /api/pair/start safely repeatable and what lets a customer who wandered
 * off come back and reopen the same QR inside the TTL. The bind happens on the
 * engine side, so the engine calls back into this app (POST /api/pair/bind) and
 * that route is the only caller of this function.
 *
 * ── WHAT IS STORED, AND WHAT IS DELIBERATELY NOT ──────────────────────────
 * A WhatsApp JID IS a phone number wearing a suffix. It is never stored, never
 * logged, and never returned. Only HMAC-SHA256(MIRA_TOKEN_SECRET, jid) is kept,
 * which answers "is this the same account?" exactly and "which number is it?"
 * not at all. That is the whole requirement — a claim needs equality, never the
 * value — so keeping the value would be storing PII for no purpose.
 */

import { createHmac, timingSafeEqual } from "crypto";
import {
  getConnect,
  putConnect,
  getSubscription,
  putSubscription,
  type ConnectRecord,
} from "@/lib/store";
import { channelOfRecord } from "@/lib/pairing";

/**
 * The HMAC key. THE SAME SECRET THE CONNECT TOKEN IS SIGNED WITH, on purpose:
 * this hash is only ever compared against another hash produced by this same
 * process, so it needs no key of its own, and a second secret would be a second
 * thing to configure, rotate and forget.
 *
 * The production hard-fail is duplicated from connect-token.ts rather than
 * imported (that module keeps `secret()` private) because the consequence is
 * identical: without a real key the hash is computable by anyone holding the
 * public repo, and a forgeable claim is a stranger owning someone's assistant.
 */
function secret(): string {
  const s = process.env.MIRA_TOKEN_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "MIRA_TOKEN_SECRET is unset in production — refusing to compute forgeable WhatsApp claim hashes.",
    );
  }
  return "mira-dev-token-secret-not-for-production";
}

/**
 * A WhatsApp account identifier -> the opaque value we store.
 *
 * NORMALISED FIRST. WhatsApp hands the same account back in more than one
 * spelling — a device suffix ("...:12@s.whatsapp.net"), a differing domain, a
 * change of case — and two spellings of one account would read as two accounts,
 * which would lock a returning customer out of their own token. So everything
 * from ":" or "@" onward is dropped and what remains is lower-cased: the claim
 * is on the ACCOUNT, not on the device that happened to answer.
 */
export function whatsappIdHash(whatsappId: string): string {
  const account = whatsappId.trim().toLowerCase().split("@")[0].split(":")[0];
  return createHmac("sha256", secret()).update(`wa:${account}`).digest("base64url");
}

export type WhatsappClaimResult =
  | { ok: true; rec: ConnectRecord; firstBind: boolean }
  | { ok: false; reason: "not_found" | "foreign" | "wrong_channel" };

/**
 * Constant-time hash comparison. The hashes are not secrets in the way a
 * password is, but the comparison is the gate on somebody else's account and
 * costs nothing to do properly.
 */
function sameHash(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Bind a connect token to a WhatsApp account. The FIRST account to bind owns
 * the token; the SAME account may re-bind idempotently; any OTHER account is
 * refused.
 *
 * `tenantId` is the engine tenant created AT BIND — never before
 * [decisions#345 Q_A] — and is recorded so a revocation months later can still
 * find the customer after the 7-day connect TTL has expired (gotchas#267).
 *
 * WHAT IS NOT A GATE HERE: the phone number. [decisions#345 Q_B] rules that a
 * mismatch between the number given at signup and the number that scanned is
 * ADVISORY ONLY. It was overruled on live evidence — the owner scanned with a
 * US number bought FOR the assistant while his personal line is UAE, and the
 * product deliberately sells that second number. So this function does not
 * compare `rec.phone` to anything, and must not be "improved" into doing so.
 * It cannot even try: it never sees a number, only a hash.
 */
export async function claimConnectWhatsapp(
  token: string,
  whatsappId: string,
  tenantId?: string,
): Promise<WhatsappClaimResult> {
  const rec = await getConnect(token);
  if (!rec) return { ok: false, reason: "not_found" };

  // A Telegram token must not be claimable over WhatsApp. channelOfRecord reads
  // a missing channel as "telegram" (every record predating the field was a
  // Telegram signup), so a legacy record is refused here — correctly: it has a
  // Telegram bind path and this is not it.
  if (channelOfRecord(rec) !== "whatsapp") return { ok: false, reason: "wrong_channel" };

  const hash = whatsappIdHash(whatsappId);
  if (rec.whatsappIdHash != null && !sameHash(rec.whatsappIdHash, hash)) {
    return { ok: false, reason: "foreign" };
  }

  // A RECONNECT MAY ONLY EVER RESTORE THE NUMBER IT WAS ISSUED FOR.
  //
  // A reconnect token is minted fresh, so it carries no whatsappIdHash yet and
  // the check above cannot fire — without this, scanning that QR from ANY
  // WhatsApp account would bind it, and a link delivered to a broken number
  // would have become a silent number change with no authentication at all.
  // The reconnect path therefore stamps the number it expects, and a scan from
  // anything else is refused here. Moving an account to a different number is
  // a separate flow that authenticates against the canonical account.
  if (rec.expectedChannelIdHash != null && !sameHash(rec.expectedChannelIdHash, hash)) {
    return { ok: false, reason: "foreign" };
  }

  const firstBind = rec.whatsappIdHash == null;
  let dirty = false;
  if (firstBind) {
    rec.whatsappIdHash = hash;
    // "bound" only ever replaces "pending". A record that is already "active"
    // (paid) must not be demoted by a bind, and a revoked one must not be
    // resurrected by it — mirroring claimConnect's rule exactly.
    if (rec.status === "pending") rec.status = "bound";
    dirty = true;
  }
  if (tenantId && rec.tenantId == null) {
    rec.tenantId = tenantId;
    dirty = true;
  }
  if (dirty) await putConnect(rec);

  // Runs on EVERY successful claim, not only the first, and costs no write when
  // the durable record already agrees — a repeat bind is the one signal we get
  // from a customer whose mirror never landed.
  await mirrorTenantToSubscription(rec.customerId, rec.tenantId);

  return { ok: true, rec, firstBind };
}

/**
 * Copy the tenant id onto the durable subscription record.
 *
 * The same shape, and the same three refusals, as store.ts's
 * mirrorIdentityToSubscription — because they are the same problem: the connect
 * record expires in 7 days and a refund arrives in month 4.
 *
 *   NO customerId -> nothing to link to. The customer has not paid yet; the
 *   activation write will carry the id across when they do.
 *   NO subscription row -> do not manufacture one. Inventing a subscription for
 *   someone who has not paid is worse than a slow revocation.
 *   ALREADY BOUND TO A DIFFERENT TENANT -> leave it alone and log. Silently
 *   re-pointing it would aim the next revocation at the wrong person.
 */
async function mirrorTenantToSubscription(
  customerId: string | undefined,
  tenantId: string | undefined,
): Promise<void> {
  if (!customerId || !tenantId) return;
  const sub = await getSubscription(customerId);
  if (!sub) return;
  if (sub.tenantId === tenantId) return; // idempotent: identical, no write.
  if (sub.tenantId != null) {
    console.warn(
      "[whatsapp-claim] subscription record already bound to a different engine tenant — leaving it alone",
      { customerId },
    );
    return;
  }
  // Read-modify-write of ONE field. Deliberately NOT putSubscription(id, rec)
  // with the connect record: the durable row is the one lifecycle events write
  // status onto, so copying the connect record over it would hand a refunded or
  // on-hold customer whatever status the connect copy still remembered.
  await putSubscription(customerId, { ...sub, tenantId });
}
