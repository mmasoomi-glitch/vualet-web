/**
 * THE SIGNUP PHONE HASH — a MIRROR of the engine's, and nothing else.
 *
 * ── WHAT THIS IS FOR [decisions#345 Q_B] ──────────────────────────────────
 * The engine can see which WhatsApp account scanned the QR. This app knows
 * which number the customer typed at signup. Neither side can compare them
 * alone, so one value crosses the boundary — and it is a hash, never a number,
 * for exactly the reason the WhatsApp JID is stored as a hash in
 * @/lib/whatsapp-claim: a phone number is PII, the comparison only ever needs
 * equality, and a value you do not send cannot leak.
 *
 * IT IS ADVISORY. It can never gate. The engine logs a mismatch and continues
 * (whatsapp-gateway-v2.mjs:708-717); nothing in this repo branches on it at
 * all. Q_B was overruled on live evidence — the owner scanned with a US number
 * bought FOR the assistant while his personal line is UAE, and the product
 * deliberately sells that second number — so a strict check would have blocked
 * the product's own intended use on its first real pairing.
 *
 * ── THE ALGORITHM IS NOT A CHOICE. IT IS A MIRROR. ────────────────────────
 * Read apps/engine/src/wa-connect-pairing.mjs before touching a character of
 * this file. Two functions there define the whole contract, and BOTH sides of
 * the comparison have to land on the same bytes:
 *
 *   phoneHash(e164)              (wa-connect-pairing.mjs:124-129)
 *       digits = e164.replace(/[^0-9]/g, '')
 *       reject unless 6 <= digits.length <= 18
 *       sha256Hex(digits)
 *
 *   phoneAdvisory(...)           (wa-connect-pairing.mjs:151)
 *       scannedHash = sha256Hex(scannedExternalId)
 *
 * THE SECOND ONE LOOKS LIKE A MISMATCH AND IS NOT. It hashes the external id
 * rather than a digit string, which would be a bug if an external id were a
 * JID — sha256("12025550147@s.whatsapp.net") can never equal
 * sha256("12025550147"), and the advisory would then report a mismatch on EVERY
 * legitimate pairing and train everyone to ignore it. It is not a bug because
 * normaliseWaJid (wa-jid.mjs:60-73) has ALREADY reduced a phone-number address
 * to BARE DIGITS — no "+", no "@domain", 6..18 of them — before it is ever
 * called an external id. LIDs, which carry no number, are short-circuited to
 * "not comparable" ahead of the hash (wa-connect-pairing.mjs:148). So both
 * sides hash the same digit string, and the engine's own test proves it:
 * phoneHash('+1 603 999 3369') equals sha256Hex('16039993369')
 * (test/wa-connect-pairing.test.mjs:314-316). VERIFIED by reading both files.
 *
 * ── WHY IT IS UNKEYED, SAID OUT LOUD ─────────────────────────────────────
 * A plain SHA-256 of a phone number is NOT a privacy control. The search space
 * is small enough to enumerate, so anyone holding a hash and a wordlist of
 * numbers recovers the number. We match it anyway, because the alternative is
 * worse in every direction: a keyed hash would need a secret shared with the
 * engine that does not exist yet, and a hash the two sides compute differently
 * is worse than no hash at all — it lies on every pairing. What this DOES buy
 * is real and worth having: the raw number never crosses the boundary, never
 * lands in a log, and never reaches a database column. If the advisory is ever
 * promoted beyond a log line, replace this with an HMAC on BOTH sides together.
 */

import { createHash } from "crypto";

/** Hex SHA-256, matching the engine's sha256Hex (wa-connect-pairing.mjs:57). */
function sha256Hex(s: string): string {
  return createHash("sha256").update(String(s), "utf8").digest("hex");
}

/**
 * The hash of a signup phone number, or null when there is nothing comparable.
 *
 * NULL IS A FIRST-CLASS ANSWER and callers must send NOTHING when they get it.
 * An absent hash makes the engine report "not comparable" (match === null),
 * which is true. A fabricated or wrongly-shaped one would make it report a
 * MISMATCH, which is a lie about a real customer.
 *
 * The 6..18 digit bounds are the engine's, not a guess: outside them the engine
 * returns null too, so a number this rejects is a number it would also refuse
 * to compare. Keeping the bounds identical is what stops one side hashing a
 * value the other side treats as absent.
 */
export function signupPhoneHash(e164: string | null | undefined): string | null {
  if (typeof e164 !== "string") return null;
  const digits = e164.replace(/[^0-9]/g, "");
  if (digits.length < 6 || digits.length > 18) return null;
  return sha256Hex(digits);
}
