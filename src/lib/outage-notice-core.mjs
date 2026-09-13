/**
 * The message to a customer who is paying and has no working assistant.
 *
 * ── WHY THE COPY DOES NOT NAME A CAUSE ────────────────────────────────────
 * It was drafted to say "something we changed broke your connection", which is
 * what we believed. Checking the store before sending showed that could not be
 * proven: none of the affected subscriptions carries a tenant id or a bound
 * identifier, and their connect records had already expired, so it is equally
 * possible they never completed pairing at all. The gateway reports them as
 * pending rather than stale.
 *
 * Apologising for the wrong thing is its own failure — a customer who never
 * finished setting up, told that we broke their connection, learns that we do
 * not know what happened to them.
 *
 * So the copy asserts only what is certain and verifiable: they are paying,
 * they have no working assistant, and getting them one is our job. That is
 * true whichever way the cause falls, and the offer is deserved either way.
 *
 * ── WHAT THE COPY MAY NEVER CONTAIN ───────────────────────────────────────
 * A phone number, a WhatsApp JID, an account id, a token, an internal state
 * name, or the words "outage", "incident", "degraded" or "OFFLINE". A customer
 * does not think in those words and should not have to.
 *
 * ── WHAT THE COPY MAY NEVER CLAIM ─────────────────────────────────────────
 * That the goodwill has already been applied. Entitlement here is gated on the
 * subscription status alone, and extending a period is an action in the payment
 * processor's admin that this code cannot take. Telling a paying customer their
 * credit is applied when it is merely owed would be a lie, and a lie inside an
 * apology is worse than the thing being apologised for. It is written as a
 * commitment, and the obligation is recorded in the goodwill ledger so somebody
 * actually discharges it.
 *
 * PURE: no imports, no I/O, no clock.
 */

export const OUTAGE_OFFER = Object.freeze({ kind: 'free_days', value: 15 });

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function describeOffer(offer) {
  if (!offer || typeof offer !== 'object') return '';
  const value = offer.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return value === 1 ? '1 day of free usage' : `${value} days of free usage`;
}

/**
 * Roughly how long, in words.
 *
 * A timestamp pasted into a sentence reads like a log line and makes the
 * customer do arithmetic to find out how long they were without the thing they
 * pay for. "Since last Sunday" is what a person would say.
 */
function howLong(sinceIso, nowIso) {
  if (typeof sinceIso !== 'string' || sinceIso.trim().length === 0) return '';
  const since = Date.parse(sinceIso);
  const now = Date.parse(typeof nowIso === 'string' ? nowIso : '');
  if (!Number.isFinite(since) || !Number.isFinite(now) || now <= since) return '';
  const days = Math.floor((now - since) / 86400000);
  if (days < 1) return '';
  if (days === 1) return ' and has not been since yesterday';
  return ` and has not been for ${days} days`;
}

export function buildOutageNotice(input) {
  const i = input && typeof input === 'object' ? input : {};
  const { reconnectUrl, offer, sinceIso, nowIso, supportEmail } = i;

  if (typeof reconnectUrl !== 'string' || reconnectUrl.trim().length === 0) {
    return { ok: false, reason: 'A notice needs somewhere for the customer to go.' };
  }
  if (
    !offer ||
    typeof offer !== 'object' ||
    offer.kind !== 'free_days' ||
    typeof offer.value !== 'number' ||
    !Number.isInteger(offer.value) ||
    offer.value <= 0
  ) {
    return { ok: false, reason: 'The offer must be a whole number of free days.' };
  }

  const url = reconnectUrl.trim();
  const duration = howLong(sinceIso, nowIso);
  const gift = describeOffer(offer);
  const support =
    typeof supportEmail === 'string' && supportEmail.trim().length > 0 ? supportEmail.trim() : '';

  // Leads with what happened and whose fault it was. No "we wanted to let you
  // know" — that makes the reader wait for the point while already annoyed.
  const paragraphs = [
    `Mira is not connected to your WhatsApp${duration}, so she has not been able to answer you. ` +
      'That is our job to put right, not yours.',
    'You are not doing anything wrong and there is nothing to fix at your end. ' +
      'We should have noticed and contacted you sooner than this.',
    'Nothing is lost. Your subscription, your settings and anything Mira has learned are ' +
      'exactly as you left them. Only the connection needs making.',
    'It takes about a minute and costs nothing: open the link below and scan the QR code ' +
      'with WhatsApp on your phone.',
    // A commitment, not a claim. Somebody has to actually do this.
    `We are also adding ${gift} to your subscription for the time you have paid for and not had.`,
  ];

  const closing = support
    ? `If anything does not work, reply to this message or write to ${support} and a person will help.`
    : 'If anything does not work, reply to this message and a person will help.';

  const text = [...paragraphs, url, closing, '— Mira'].join('\n\n');

  const html = [
    ...paragraphs.map((p) => `<p>${esc(p)}</p>`),
    `<p><a href="${esc(url)}">Reconnect Mira to WhatsApp</a></p>`,
    `<p>${esc(closing)}</p>`,
    '<p>— Mira</p>',
  ].join('\n');

  return {
    ok: true,
    notice: {
      // Plain and specific. Not "We're sorry!", which reads as marketing; not
      // "Mira is back", which is untrue until they connect; and not a claim
      // about a cause that could not be proven before sending.
      subject: 'Mira is not connected yet — here is how to finish it',
      text,
      html,
    },
  };
}
