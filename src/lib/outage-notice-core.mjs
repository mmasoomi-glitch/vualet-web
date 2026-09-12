/**
 * The message to a customer whose assistant went silent.
 *
 * WHAT HAPPENED, so the copy can be honest. A fault on our side destroyed the
 * stored credentials that made Mira a linked device on the customer's own
 * WhatsApp. From their side she simply stopped answering — no error, no notice,
 * nothing — for about five days. Nobody told them, because nothing was
 * watching. It was entirely our fault; they did nothing wrong and there was
 * nothing they could have noticed.
 *
 * WHAT THE COPY MAY NEVER CONTAIN: a phone number, a WhatsApp JID, an account
 * id, a token, an internal state name, or the words "outage", "incident",
 * "degraded" or "OFFLINE". A customer does not think in those words and should
 * not have to.
 *
 * WHAT THE COPY MAY NEVER CLAIM: that the goodwill has already been applied.
 * Entitlement here is gated on the subscription status alone, and extending a
 * period is an action in the payment processor's admin that this code cannot
 * take. Telling a paying customer their credit is applied when it is merely
 * owed would be a lie, and a lie in an apology is worse than the original
 * fault. It is written as a commitment, and the obligation is recorded in the
 * goodwill ledger so somebody actually discharges it.
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
  if (days < 1) return ' for most of today';
  if (days === 1) return ' since yesterday';
  return ` for the last ${days} days`;
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
    `Mira stopped answering you${duration}, and that was our fault.`,
    'Something we changed on our side broke the connection between Mira and your WhatsApp. ' +
      'She was not ignoring you and there was nothing wrong at your end — and we should have ' +
      'spotted it and told you, rather than leaving you to notice the silence.',
    'Nothing was lost. Your subscription, everything Mira remembers and all your settings are ' +
      'exactly as you left them. Only the connection needs putting back.',
    `That takes about a minute and costs nothing: open the link below and scan the QR code with ` +
      `WhatsApp on your phone.`,
    // A commitment, not a claim. Somebody has to actually do this.
    `We are also adding ${gift} to your subscription for the time you lost.`,
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
      // Plain and specific. Not "We're sorry!", which reads as marketing, and
      // not "Mira is back", which would be untrue until they reconnect.
      subject: 'Mira stopped answering you — here is how to bring her back',
      text,
      html,
    },
  };
}
