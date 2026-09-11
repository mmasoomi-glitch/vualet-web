/**
 * Channel bindings — the pure decision layer.
 *
 * THE CENTRAL RULE: the phone number is not the customer. The account is the
 * customer, and a phone number is a replaceable binding to it. Changing a
 * number must never create a new customer, never restart a subscription, and
 * never lose context. Only the binding changes.
 *
 * This exists because recovery used to be manual. A customer whose WhatsApp
 * session broke had no way back without a human issuing something by hand, and
 * two of them sat disconnected for days. Routine disconnection, re-pairing and
 * number changes must be automatic; a human is the exceptional security path,
 * not the normal mechanism.
 *
 * A WhatsApp JID is a phone number wearing a suffix, so no raw identifier is
 * ever handled here — this module only ever sees an opaque hash.
 *
 * PURE: no imports, no I/O, no clock, no randomness. Every id and timestamp is
 * a parameter, so every rule below is deterministic and testable.
 */

export const BINDING_STATES = Object.freeze({
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  DISCONNECTED: 'DISCONNECTED',
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  REVOKED: 'REVOKED',
  SUPERSEDED: 'SUPERSEDED',
  COMPROMISED: 'COMPROMISED',
  EXPIRED: 'EXPIRED',
});

export const ACTOR_TYPES = Object.freeze({
  CUSTOMER: 'CUSTOMER',
  SYSTEM: 'SYSTEM',
  PROVIDER: 'PROVIDER',
  ADMIN: 'ADMIN',
  SUPPORT: 'SUPPORT',
  SECURITY_AUTOMATION: 'SECURITY_AUTOMATION',
  UNKNOWN: 'UNKNOWN',
});

export const DISCONNECT_SOURCES = Object.freeze({
  USER_INITIATED: 'USER_INITIATED',
  PROVIDER_INITIATED: 'PROVIDER_INITIATED',
  SYSTEM_INITIATED: 'SYSTEM_INITIATED',
  SECURITY_INITIATED: 'SECURITY_INITIATED',
  INFRASTRUCTURE_FAILURE: 'INFRASTRUCTURE_FAILURE',
  UNKNOWN: 'UNKNOWN',
});

export const REASON_CODES = Object.freeze({
  USER_LOGOUT: 'USER_LOGOUT',
  USER_REMOVED_DEVICE: 'USER_REMOVED_DEVICE',
  USER_CHANGED_NUMBER: 'USER_CHANGED_NUMBER',
  DEVICE_REPLACED: 'DEVICE_REPLACED',
  CREDENTIAL_EXPIRED: 'CREDENTIAL_EXPIRED',
  PROVIDER_REVOKED: 'PROVIDER_REVOKED',
  PROVIDER_OUTAGE: 'PROVIDER_OUTAGE',
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  SECURITY_REVOCATION: 'SECURITY_REVOCATION',
  ACCOUNT_MERGE: 'ACCOUNT_MERGE',
  ADMIN_REVOCATION: 'ADMIN_REVOCATION',
  UNKNOWN_DISCONNECT: 'UNKNOWN_DISCONNECT',
});

export const INBOUND_CLASSES = Object.freeze({
  KNOWN_ACTIVE_BINDING: 'KNOWN_ACTIVE_BINDING',
  KNOWN_DISCONNECTED_BINDING: 'KNOWN_DISCONNECTED_BINDING',
  UNKNOWN_NUMBER: 'UNKNOWN_NUMBER',
  NUMBER_PENDING_MIGRATION: 'NUMBER_PENDING_MIGRATION',
  REVOKED_NUMBER: 'REVOKED_NUMBER',
  SECURITY_BLOCKED: 'SECURITY_BLOCKED',
});

export const FAULT = Object.freeze({
  CUSTOMER_CAUSED: 'CUSTOMER_CAUSED',
  PLATFORM_CAUSED: 'PLATFORM_CAUSED',
  PROVIDER_CAUSED: 'PROVIDER_CAUSED',
  SECURITY_ACTION: 'SECURITY_ACTION',
  SHARED_OR_AMBIGUOUS: 'SHARED_OR_AMBIGUOUS',
  UNKNOWN: 'UNKNOWN',
});

export const ACTIONS = Object.freeze({
  SERVE: 'SERVE',
  OFFER_RECONNECT: 'OFFER_RECONNECT',
  OFFER_ONBOARDING: 'OFFER_ONBOARDING',
  REFUSE: 'REFUSE',
  HOLD_FOR_MIGRATION: 'HOLD_FOR_MIGRATION',
});

function verdict(klass, action, binding, reasonCode) {
  return {
    klass,
    action,
    bindingId: (binding && binding.bindingId) || null,
    accountId: (binding && binding.accountId) || null,
    reasonCode: reasonCode || null,
  };
}

/**
 * What does a message arriving on a WhatsApp channel mean?
 *
 * THE ORDER OF THESE RULES IS THE SECURITY PROPERTY. A later rule must never
 * be able to serve a sender an earlier rule refused.
 */
export function classifyInbound(input) {
  const { binding, securityBlocked, migrationPending } =
    input && typeof input === 'object' ? input : {};

  // FIRST, always. Nothing below may serve a blocked sender.
  if (securityBlocked === true) {
    return verdict(INBOUND_CLASSES.SECURITY_BLOCKED, ACTIONS.REFUSE, null, null);
  }

  // An unknown number is a stranger. Never assume it is an existing customer,
  // and never silently attach it to one.
  if (!binding || typeof binding !== 'object') {
    return verdict(INBOUND_CLASSES.UNKNOWN_NUMBER, ACTIONS.OFFER_ONBOARDING, null, null);
  }

  const state = binding.state;

  // A telecom operator can reassign a number months later, so a message from a
  // revoked number proves nothing about who is holding it now. Revoked means
  // revoked: it must never automatically regain the account, and the new holder
  // must never receive the previous customer's context.
  if (state === BINDING_STATES.REVOKED || state === BINDING_STATES.SUPERSEDED) {
    return verdict(
      INBOUND_CLASSES.REVOKED_NUMBER,
      ACTIONS.REFUSE,
      binding,
      binding.revocationReason,
    );
  }

  if (migrationPending === true) {
    return verdict(INBOUND_CLASSES.NUMBER_PENDING_MIGRATION, ACTIONS.HOLD_FOR_MIGRATION, binding, null);
  }

  if (state === BINDING_STATES.ACTIVE) {
    return verdict(INBOUND_CLASSES.KNOWN_ACTIVE_BINDING, ACTIONS.SERVE, binding, null);
  }

  if (
    state === BINDING_STATES.DISCONNECTED ||
    state === BINDING_STATES.REAUTH_REQUIRED ||
    state === BINDING_STATES.EXPIRED ||
    state === BINDING_STATES.PENDING
  ) {
    return verdict(INBOUND_CLASSES.KNOWN_DISCONNECTED_BINDING, ACTIONS.OFFER_RECONNECT, binding, null);
  }

  if (state === BINDING_STATES.COMPROMISED) {
    return verdict(INBOUND_CLASSES.SECURITY_BLOCKED, ACTIONS.REFUSE, binding, null);
  }

  // An unrecognised state is a bug or a corrupt record. Treat the sender as a
  // stranger rather than guessing — serving on an unknown state is how a
  // revoked binding would get quietly reinstated by a typo.
  return verdict(INBOUND_CLASSES.UNKNOWN_NUMBER, ACTIONS.OFFER_ONBOARDING, binding, null);
}

/**
 * REVOKED and SUPERSEDED are terminal on purpose: a binding that has been
 * taken away must not have a path back, or number recycling and supersession
 * both become reversible by a single bad write.
 */
const LEGAL_TRANSITIONS = Object.freeze({
  [BINDING_STATES.PENDING]: Object.freeze([
    BINDING_STATES.ACTIVE,
    BINDING_STATES.EXPIRED,
    BINDING_STATES.REVOKED,
  ]),
  [BINDING_STATES.ACTIVE]: Object.freeze([
    BINDING_STATES.DISCONNECTED,
    BINDING_STATES.REAUTH_REQUIRED,
    BINDING_STATES.REVOKED,
    BINDING_STATES.SUPERSEDED,
    BINDING_STATES.COMPROMISED,
  ]),
  [BINDING_STATES.DISCONNECTED]: Object.freeze([
    BINDING_STATES.ACTIVE,
    BINDING_STATES.REAUTH_REQUIRED,
    BINDING_STATES.REVOKED,
    BINDING_STATES.SUPERSEDED,
    BINDING_STATES.COMPROMISED,
  ]),
  [BINDING_STATES.REAUTH_REQUIRED]: Object.freeze([
    BINDING_STATES.ACTIVE,
    BINDING_STATES.REVOKED,
    BINDING_STATES.SUPERSEDED,
    BINDING_STATES.COMPROMISED,
    BINDING_STATES.EXPIRED,
  ]),
  [BINDING_STATES.EXPIRED]: Object.freeze([
    BINDING_STATES.ACTIVE,
    BINDING_STATES.REVOKED,
    BINDING_STATES.SUPERSEDED,
  ]),
  [BINDING_STATES.COMPROMISED]: Object.freeze([BINDING_STATES.REVOKED]),
  [BINDING_STATES.REVOKED]: Object.freeze([]),
  [BINDING_STATES.SUPERSEDED]: Object.freeze([]),
});

export function canTransition(from, to) {
  // A no-op must not be legal, or every idle probe would mint an event and the
  // timeline would drown in transitions that changed nothing.
  if (from === to) return false;
  const allowed = LEGAL_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function describeTransition(from, to, actorType, reasonCode) {
  if (!canTransition(from, to)) {
    return { ok: false, reason: `${from} cannot become ${to}.` };
  }
  const who = actorType || ACTOR_TYPES.UNKNOWN;
  const why = reasonCode || REASON_CODES.UNKNOWN_DISCONNECT;
  return { ok: true, reason: `${from} -> ${to} by ${who} (${why})` };
}

/**
 * What does the evidence say caused this?
 *
 * THIS FUNCTION NEVER CONCLUDES ANYTHING ABOUT LIABILITY OR MONEY. It reports
 * what the evidence shows and stops. A system that hard-codes "the company owes
 * nothing" is both wrong and indefensible; a system that preserves the facts
 * lets a human policy decide, and defends itself.
 */
export function attributeFault(evidence) {
  const { source, reasonCode, platformHealthy, providerHealthy } =
    evidence && typeof evidence === 'object' ? evidence : {};

  const is = (...codes) => codes.includes(reasonCode);

  if (
    source === DISCONNECT_SOURCES.USER_INITIATED ||
    is(
      REASON_CODES.USER_LOGOUT,
      REASON_CODES.USER_REMOVED_DEVICE,
      REASON_CODES.USER_CHANGED_NUMBER,
      REASON_CODES.DEVICE_REPLACED,
    )
  ) {
    return { fault: FAULT.CUSTOMER_CAUSED, confident: true, why: `customer action (${source || reasonCode})` };
  }

  if (
    source === DISCONNECT_SOURCES.SECURITY_INITIATED ||
    is(REASON_CODES.SECURITY_REVOCATION, REASON_CODES.ADMIN_REVOCATION)
  ) {
    return { fault: FAULT.SECURITY_ACTION, confident: true, why: `security action (${source || reasonCode})` };
  }

  if (
    source === DISCONNECT_SOURCES.PROVIDER_INITIATED ||
    is(REASON_CODES.PROVIDER_REVOKED, REASON_CODES.PROVIDER_OUTAGE)
  ) {
    return { fault: FAULT.PROVIDER_CAUSED, confident: true, why: `provider action (${source || reasonCode})` };
  }

  if (source === DISCONNECT_SOURCES.SYSTEM_INITIATED || is(REASON_CODES.SYSTEM_ERROR)) {
    return { fault: FAULT.PLATFORM_CAUSED, confident: true, why: `platform fault (${source || reasonCode})` };
  }

  if (source === DISCONNECT_SOURCES.INFRASTRUCTURE_FAILURE) {
    if (platformHealthy === false) {
      return { fault: FAULT.PLATFORM_CAUSED, confident: true, why: 'infrastructure failure while the platform was unhealthy' };
    }
    if (providerHealthy === false) {
      return { fault: FAULT.PROVIDER_CAUSED, confident: true, why: 'infrastructure failure while the provider was unhealthy' };
    }
    // Saying "shared" honestly is worth more than a confident guess that later
    // turns out to have decided someone's refund.
    return { fault: FAULT.SHARED_OR_AMBIGUOUS, confident: false, why: 'infrastructure failure with no health evidence either way' };
  }

  return { fault: FAULT.UNKNOWN, confident: false, why: 'no evidence identifying a cause' };
}

/**
 * A channel binding changing MUST NEVER alter entitlement. The subscription
 * belongs to the account, not to the phone number: a customer who changes
 * number on day 12 of 30 has 18 days left, not 30 new ones and not zero.
 *
 * This is a function rather than a comment so a test can assert it for every
 * reason code, including ones added later.
 */
export function subscriptionUnaffectedBy(reasonCode) {
  void reasonCode;
  return true;
}
