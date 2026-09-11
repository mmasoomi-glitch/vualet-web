/**
 * Telling a customer their WhatsApp binding changed — the copy and the rules.
 *
 * WHY THIS IS NOT A RECEIPT. When the number bound to an account changes, the
 * customer must be told on a channel the change did NOT go through. If the only
 * notice went to the new number, a SIM-swap attacker who had just taken the
 * account over would be the only person who ever saw it.
 *
 * This notice is the control that lets a victim notice a takeover in time to
 * stop it. Email is the out-of-band channel, because it is the one a SIM swap
 * does not capture.
 *
 * PURE: no imports, no I/O, no clock. The caller supplies the timestamp.
 */

export const NOTICE_KINDS = Object.freeze({
  NUMBER_CHANGED: 'NUMBER_CHANGED',
  BINDING_REVOKED: 'BINDING_REVOKED',
  BINDING_RECONNECTED: 'BINDING_RECONNECTED',
  SECURITY_REVOCATION: 'SECURITY_REVOCATION',
});

const KINDS = Object.values(NOTICE_KINDS);

/**
 * Enough of the number to recognise, never enough to reuse.
 *
 * An email gets forwarded, sits in an inbox for years and is the single most
 * likely place for a number to leak, so the notice identifies which number it
 * means without reproducing it.
 */
export function maskIdentifier(raw) {
  if (typeof raw !== 'string') return 'your number';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4) return 'your number';
  return `••••${digits.slice(-4)}`;
}

/** A notice about a security event must not itself be an injection vector. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The four things worth interrupting somebody for.
 *
 * Each says WHAT happened and WHEN. The "if this wasn't you" line is appended
 * to every one of them, because that sentence is the entire reason the email
 * is sent.
 */
const COPY = Object.freeze({
  [NOTICE_KINDS.NUMBER_CHANGED]: Object.freeze({
    subject: 'Your WhatsApp number was changed',
    line: (o, n) => `The WhatsApp number on your account was changed from ${o} to ${n}.`,
  }),
  [NOTICE_KINDS.BINDING_REVOKED]: Object.freeze({
    subject: 'Your WhatsApp connection was disconnected',
    line: (o) => `The WhatsApp connection on your account (${o}) was disconnected.`,
  }),
  [NOTICE_KINDS.BINDING_RECONNECTED]: Object.freeze({
    subject: 'Your WhatsApp was reconnected',
    line: (o) => `Your WhatsApp connection (${o}) was reconnected and is working again.`,
  }),
  [NOTICE_KINDS.SECURITY_REVOCATION]: Object.freeze({
    subject: 'We ended your WhatsApp session',
    line: (o) => `We ended the WhatsApp session on your account (${o}) to protect it.`,
  }),
});

export function buildNotice(input) {
  const i = input && typeof input === 'object' ? input : {};
  const { kind, oldIdentifier, newIdentifier, atIso, secureAccountUrl } = i;

  // Object.values rather than a property lookup: NOTICE_KINDS['constructor']
  // resolves up the prototype chain and would have passed a bare `in`-style
  // check.
  if (!KINDS.includes(kind)) {
    return { ok: false, reason: `Unrecognised notice kind "${String(kind)}".` };
  }
  if (typeof atIso !== 'string' || atIso.trim().length === 0) {
    return { ok: false, reason: 'A notice needs the time it happened.' };
  }

  // NOTHING IDENTIFYING GOES IN THE BODY: no full number, no account id, no
  // binding id, no token, no internal state name. Only masked digits and a time.
  const oldMasked = maskIdentifier(oldIdentifier);
  const newMasked = maskIdentifier(newIdentifier);

  const url = typeof secureAccountUrl === 'string' && secureAccountUrl.trim().length > 0
    ? secureAccountUrl.trim()
    : null;

  const copy = COPY[kind];
  const what = copy.line(oldMasked, newMasked);
  const when = `This happened at ${atIso}.`;
  const ifNotYou = url
    ? `If this wasn't you, secure your account now: ${url}`
    : "If this wasn't you, contact support straight away.";

  const text = `${what}\n\n${when}\n\n${ifNotYou}`;

  const htmlAction = url
    ? `If this wasn&#39;t you, <a href="${esc(url)}">secure your account now</a>.`
    : 'If this wasn&#39;t you, contact support straight away.';

  const html =
    `<p>${esc(what)}</p>` +
    `<p>${esc(when)}</p>` +
    `<p>${htmlAction}</p>`;

  return { ok: true, notice: { subject: copy.subject, text, html } };
}

/**
 * Which channel, if any, this notice may go out on.
 *
 * WhatsApp is deliberately never an option. The change may have been made by
 * whoever now controls that number, so sending the warning there would be
 * telling the attacker and nobody else.
 */
export function shouldNotify(kind, hasVerifiedEmail) {
  if (!KINDS.includes(kind)) {
    return { notify: false, channel: null, reason: 'Unrecognised notice kind.' };
  }
  if (hasVerifiedEmail !== true) {
    return {
      notify: false,
      channel: null,
      reason: 'No verified out-of-band channel on this account.',
    };
  }
  return { notify: true, channel: 'email', reason: 'Sending to the verified email.' };
}
