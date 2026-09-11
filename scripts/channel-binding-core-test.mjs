// Channel bindings — the pure decision layer.
//
// The ORDER of the classification rules is a security property, so most of
// this file is adversarial: it asks whether a later rule can serve a sender an
// earlier rule refused.

import test from "node:test";
import assert from "node:assert/strict";
import {
  BINDING_STATES,
  ACTOR_TYPES,
  DISCONNECT_SOURCES,
  REASON_CODES,
  INBOUND_CLASSES,
  FAULT,
  ACTIONS,
  classifyInbound,
  canTransition,
  describeTransition,
  attributeFault,
  subscriptionUnaffectedBy,
} from "../src/lib/channel-binding-core.mjs";

const ALL_STATES = Object.values(BINDING_STATES);

/** A binding in a given state, with everything else valid. */
const bind = (state, over = {}) => ({
  bindingId: "bnd_1",
  accountId: "acct_1",
  state,
  ...over,
});

/* ── the constants ─────────────────────────────────────────────────────── */

test("every constant table is frozen", () => {
  for (const [name, table] of Object.entries({
    BINDING_STATES,
    ACTOR_TYPES,
    DISCONNECT_SOURCES,
    REASON_CODES,
    INBOUND_CLASSES,
    FAULT,
    ACTIONS,
  })) {
    assert.ok(Object.isFrozen(table), `${name} must not be mutable at runtime`);
    for (const [k, v] of Object.entries(table)) {
      assert.equal(k, v, `${name}.${k} must equal its own name, so a stored string is self-describing`);
    }
  }
});

/* ── classifyInbound: the security ordering ────────────────────────────── */

test("A SECURITY BLOCK BEATS EVERY OTHER RULE", () => {
  // Even a perfectly good ACTIVE binding must not be served when blocked.
  for (const state of ALL_STATES) {
    const r = classifyInbound({ binding: bind(state), securityBlocked: true, migrationPending: false });
    assert.equal(r.klass, INBOUND_CLASSES.SECURITY_BLOCKED, `${state} + blocked must be blocked`);
    assert.equal(r.action, ACTIONS.REFUSE, `${state} + blocked must refuse`);
  }
  const withMigration = classifyInbound({
    binding: bind(BINDING_STATES.ACTIVE),
    securityBlocked: true,
    migrationPending: true,
  });
  assert.equal(withMigration.action, ACTIONS.REFUSE, "a pending migration must not unblock a blocked sender");
});

test("a security block leaks no binding identifiers", () => {
  const r = classifyInbound({ binding: bind(BINDING_STATES.ACTIVE), securityBlocked: true });
  assert.equal(r.bindingId, null, "a refused sender is told nothing about the account it targeted");
  assert.equal(r.accountId, null, "and nothing about the account id");
});

test("AN UNKNOWN NUMBER IS A STRANGER, NEVER AN EXISTING CUSTOMER", () => {
  for (const binding of [null, undefined, "", 0, false, "nonsense", 42]) {
    const r = classifyInbound({ binding, securityBlocked: false });
    assert.equal(
      r.klass,
      INBOUND_CLASSES.UNKNOWN_NUMBER,
      `binding ${String(binding)} must not resolve to a customer`,
    );
    assert.equal(r.action, ACTIONS.OFFER_ONBOARDING, "a stranger is onboarded, never served");
    assert.equal(r.accountId, null, "and is attached to no account");
  }
});

test("REVOKED MEANS REVOKED — a recycled number never regains the account", () => {
  for (const state of [BINDING_STATES.REVOKED, BINDING_STATES.SUPERSEDED]) {
    const r = classifyInbound({
      binding: bind(state, { revocationReason: REASON_CODES.USER_CHANGED_NUMBER }),
      securityBlocked: false,
    });
    assert.equal(r.klass, INBOUND_CLASSES.REVOKED_NUMBER, `${state} is a revoked number`);
    assert.equal(
      r.action,
      ACTIONS.REFUSE,
      "a telecom operator can reassign a number months later, so the new holder must never reach the previous customer's context",
    );
    assert.equal(r.reasonCode, REASON_CODES.USER_CHANGED_NUMBER, "the reason is carried for the timeline");
  }
});

test("A PENDING MIGRATION CANNOT RESURRECT A REVOKED BINDING", () => {
  const r = classifyInbound({
    binding: bind(BINDING_STATES.REVOKED),
    securityBlocked: false,
    migrationPending: true,
  });
  assert.equal(
    r.action,
    ACTIONS.REFUSE,
    "revocation is checked before migration, or claiming a migration would be enough to reclaim a number someone else now owns",
  );
});

test("an active binding is served", () => {
  const r = classifyInbound({ binding: bind(BINDING_STATES.ACTIVE), securityBlocked: false });
  assert.equal(r.klass, INBOUND_CLASSES.KNOWN_ACTIVE_BINDING, "the normal case");
  assert.equal(r.action, ACTIONS.SERVE, "and it is served");
  assert.equal(r.accountId, "acct_1", "attached to its account");
});

test("a broken session is offered reconnection, not a support ticket", () => {
  for (const state of [
    BINDING_STATES.DISCONNECTED,
    BINDING_STATES.REAUTH_REQUIRED,
    BINDING_STATES.EXPIRED,
    BINDING_STATES.PENDING,
  ]) {
    const r = classifyInbound({ binding: bind(state), securityBlocked: false });
    assert.equal(r.klass, INBOUND_CLASSES.KNOWN_DISCONNECTED_BINDING, `${state} is recoverable`);
    assert.equal(
      r.action,
      ACTIONS.OFFER_RECONNECT,
      "there must be no normal manual recovery workflow — a customer who says hi gets a link, not a wait",
    );
    assert.equal(r.bindingId, "bnd_1", "the binding being recovered is identified");
  }
});

test("a compromised binding is a security case, not a recovery case", () => {
  const r = classifyInbound({ binding: bind(BINDING_STATES.COMPROMISED), securityBlocked: false });
  assert.equal(r.klass, INBOUND_CLASSES.SECURITY_BLOCKED, "compromise is not something to self-serve out of");
  assert.equal(r.action, ACTIONS.REFUSE, "and it is refused");
});

test("AN UNRECOGNISED STATE IS NEVER SERVED", () => {
  for (const state of [undefined, null, "", "ACTIVE_", "active", "GARBAGE", 1]) {
    const r = classifyInbound({ binding: bind(state), securityBlocked: false });
    assert.notEqual(
      r.action,
      ACTIONS.SERVE,
      `state ${String(state)} was served; a typo or a corrupt record must not quietly reinstate a binding`,
    );
  }
});

test("classifyInbound never throws", () => {
  for (const input of [null, undefined, "nope", 5, [], {}]) {
    const r = classifyInbound(input);
    assert.ok(r && typeof r.klass === "string", `${String(input)} still yields a verdict`);
    assert.ok(Object.values(ACTIONS).includes(r.action), "and a real action");
  }
});

/* ── transitions ───────────────────────────────────────────────────────── */

test("REVOKED AND SUPERSEDED ARE TERMINAL", () => {
  for (const terminal of [BINDING_STATES.REVOKED, BINDING_STATES.SUPERSEDED]) {
    for (const to of ALL_STATES) {
      assert.equal(
        canTransition(terminal, to),
        false,
        `${terminal} -> ${to} must be impossible; a binding that was taken away must have no path back`,
      );
    }
  }
});

test("a no-op is not a transition", () => {
  for (const state of ALL_STATES) {
    assert.equal(canTransition(state, state), false, `${state} -> ${state} must not mint an event`);
  }
});

test("the ordinary recovery path is legal", () => {
  assert.ok(canTransition(BINDING_STATES.ACTIVE, BINDING_STATES.DISCONNECTED), "it can break");
  assert.ok(canTransition(BINDING_STATES.DISCONNECTED, BINDING_STATES.ACTIVE), "and it can come back");
  assert.ok(canTransition(BINDING_STATES.PENDING, BINDING_STATES.ACTIVE), "a new binding can activate");
  assert.ok(canTransition(BINDING_STATES.ACTIVE, BINDING_STATES.SUPERSEDED), "a number change supersedes it");
});

test("a compromised binding can only be revoked", () => {
  for (const to of ALL_STATES) {
    const expected = to === BINDING_STATES.REVOKED;
    assert.equal(
      canTransition(BINDING_STATES.COMPROMISED, to),
      expected,
      `COMPROMISED -> ${to} should be ${expected}; a compromised session must never be reactivated`,
    );
  }
});

test("an unknown state transitions nowhere", () => {
  assert.equal(canTransition("GARBAGE", BINDING_STATES.ACTIVE), false, "unknown source");
  assert.equal(canTransition(BINDING_STATES.ACTIVE, "GARBAGE"), false, "unknown target");
  assert.equal(canTransition(undefined, undefined), false, "both undefined");
});

test("describeTransition refuses illegal moves and explains legal ones", () => {
  const bad = describeTransition(BINDING_STATES.REVOKED, BINDING_STATES.ACTIVE, ACTOR_TYPES.ADMIN, null);
  assert.equal(bad.ok, false, "an illegal transition is refused");
  assert.ok(bad.reason.includes("REVOKED"), "and names the state it refused to leave");

  const good = describeTransition(
    BINDING_STATES.ACTIVE,
    BINDING_STATES.DISCONNECTED,
    ACTOR_TYPES.PROVIDER,
    REASON_CODES.PROVIDER_REVOKED,
  );
  assert.equal(good.ok, true, "a legal transition is allowed");
  assert.ok(good.reason.includes(ACTOR_TYPES.PROVIDER), "the actor is named");
  assert.ok(good.reason.includes(REASON_CODES.PROVIDER_REVOKED), "and the reason code");
});

/* ── fault attribution ─────────────────────────────────────────────────── */

test("a customer who removes their own device is not a platform outage", () => {
  for (const reasonCode of [
    REASON_CODES.USER_LOGOUT,
    REASON_CODES.USER_REMOVED_DEVICE,
    REASON_CODES.USER_CHANGED_NUMBER,
    REASON_CODES.DEVICE_REPLACED,
  ]) {
    const r = attributeFault({ reasonCode });
    assert.equal(r.fault, FAULT.CUSTOMER_CAUSED, `${reasonCode} is customer-caused`);
    assert.equal(r.confident, true, "and the evidence is unambiguous");
  }
});

test("our own fault is recorded as ours", () => {
  const r = attributeFault({ source: DISCONNECT_SOURCES.SYSTEM_INITIATED });
  assert.equal(r.fault, FAULT.PLATFORM_CAUSED, "a deployment that disconnects customers is our fault");
  assert.equal(r.confident, true, "and we say so plainly");
});

test("provider and security causes are distinguished, not collapsed", () => {
  assert.equal(attributeFault({ reasonCode: REASON_CODES.PROVIDER_OUTAGE }).fault, FAULT.PROVIDER_CAUSED, "provider");
  assert.equal(attributeFault({ reasonCode: REASON_CODES.SECURITY_REVOCATION }).fault, FAULT.SECURITY_ACTION, "security");
  assert.equal(attributeFault({ reasonCode: REASON_CODES.ADMIN_REVOCATION }).fault, FAULT.SECURITY_ACTION, "admin revocation");
});

test("AMBIGUOUS EVIDENCE IS REPORTED AS AMBIGUOUS", () => {
  const noEvidence = attributeFault({ source: DISCONNECT_SOURCES.INFRASTRUCTURE_FAILURE });
  assert.equal(noEvidence.fault, FAULT.SHARED_OR_AMBIGUOUS, "with no health evidence it is genuinely unclear");
  assert.equal(
    noEvidence.confident,
    false,
    "a confident guess here would end up deciding somebody's refund on no evidence",
  );

  const ourFault = attributeFault({ source: DISCONNECT_SOURCES.INFRASTRUCTURE_FAILURE, platformHealthy: false });
  assert.equal(ourFault.fault, FAULT.PLATFORM_CAUSED, "platform health evidence resolves it");
  assert.equal(ourFault.confident, true, "confidently");

  const theirFault = attributeFault({ source: DISCONNECT_SOURCES.INFRASTRUCTURE_FAILURE, providerHealthy: false });
  assert.equal(theirFault.fault, FAULT.PROVIDER_CAUSED, "provider health evidence resolves it the other way");
});

test("no evidence yields UNKNOWN, never a default blaming anyone", () => {
  for (const evidence of [null, undefined, {}, { source: "MADE_UP" }, "nope"]) {
    const r = attributeFault(evidence);
    assert.equal(r.fault, FAULT.UNKNOWN, `${JSON.stringify(evidence)} is unknown`);
    assert.equal(r.confident, false, "and not confident");
  }
});

test("FAULT ATTRIBUTION NEVER MENTIONS MONEY OR LIABILITY", () => {
  const forbidden = ["refund", "credit", "owe", "liable", "liability", "compensat", "legal", "entitled to"];
  const cases = [
    { reasonCode: REASON_CODES.USER_REMOVED_DEVICE },
    { source: DISCONNECT_SOURCES.SYSTEM_INITIATED },
    { source: DISCONNECT_SOURCES.INFRASTRUCTURE_FAILURE },
    {},
  ];
  for (const c of cases) {
    const why = attributeFault(c).why.toLowerCase();
    for (const word of forbidden) {
      assert.ok(
        !why.includes(word),
        `"${word}" appeared in a fault attribution — this layer reports evidence and stops; policy decides money`,
      );
    }
  }
});

/* ── the entitlement invariant ─────────────────────────────────────────── */

test("NO BINDING CHANGE EVER TOUCHES THE SUBSCRIPTION", () => {
  for (const reasonCode of [...Object.values(REASON_CODES), null, undefined, "A_CODE_ADDED_LATER"]) {
    assert.equal(
      subscriptionUnaffectedBy(reasonCode),
      true,
      `${String(reasonCode)} must not affect entitlement — the subscription belongs to the account, not the phone number; a customer who changes number on day 12 of 30 has 18 days left, not 30 new ones and not zero`,
    );
  }
});
