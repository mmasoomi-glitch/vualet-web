/**
 * ENTITLEMENT TEST (ledger gotchas#158 — the two-processor split).
 *
 * Proves the SAME core that src/lib/entitlement.ts runs in production
 * (src/lib/entitlement-core.mjs) answers "has this person paid" correctly for
 * BOTH eras: Dodo (the current merchant-of-record) and Stripe (legacy cohort).
 *
 * Every outbound Stripe/Dodo call is stubbed. No env reads, no network. Ever.
 *
 * Proves:
 *   a. Dodo-paying customer, no Stripe record       -> active true, correct plan
 *   b. Legacy Stripe customer, no Dodo record       -> unchanged, still active (no regression)
 *   c. Neither                                      -> active false, well-formed, no throw
 *   d. Dodo lookup THROWS                           -> no unhandled exception, safe Entitlement
 *   e. Stripe UNCONFIGURED but a Dodo record exists -> STILL RESOLVES  <-- the regression trap
 *
 * Run: npm run test:entitlement  (or: node --test scripts/entitlement-test.mjs)
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveEntitlement,
  entitlementFromDodoRecord,
  paidPlanOrNull,
} from "../src/lib/entitlement-core.mjs";

const ENTITLEMENT_KEYS = ["active", "status", "plan", "priceId", "customerId"];

/** Every answer must carry the exact Entitlement shape callers destructure. */
function assertWellFormed(ent) {
  assert.ok(ent && typeof ent === "object", "entitlement must be an object");
  assert.deepEqual(Object.keys(ent).sort(), [...ENTITLEMENT_KEYS].sort(), "exact Entitlement keys");
  assert.equal(typeof ent.active, "boolean");
  for (const k of ["status", "plan", "priceId", "customerId"]) {
    assert.ok(ent[k] === null || typeof ent[k] === "string", k + " must be string|null");
  }
}

// ---- stub builders ------------------------------------------------------
const dodoStore = (recordsByEmail) => async (email) => recordsByEmail[email] ?? null;
const dodoThrows = () => async () => {
  throw new Error("upstash unreachable");
};
const noDodo = async () => null;

function stripeStubs({ customers = [], subsByCustomer = {} } = {}) {
  return {
    listCustomers: async () => customers,
    listSubscriptions: async (id) => subsByCustomer[id] ?? [],
  };
}
const PRICE_TO_PLAN = { price_studio_7900: "studio", price_companion_1499: "companion" };
const planForPriceId = (p) => PRICE_TO_PLAN[p] ?? null;
const stripeSub = (status, priceId) => ({ status, items: { data: [{ price: { id: priceId } }] } });

// A real-shaped record, exactly as activateDodo() -> putSubscription() persists it.
const DODO_ACTIVE = {
  customerId: "cus_dodo_abc123",
  rec: {
    token: "tok_x",
    plan: "assistant",
    email: "paid@example.com",
    status: "active",
    customerId: "cus_dodo_abc123",
    subscriptionId: "sub_dodo_1",
    createdAt: "2026-08-01T00:00:00.000Z",
  },
};

// ---- (a) Dodo-paying customer, no Stripe record -------------------------
test("(a) Dodo-paying customer with no Stripe record is ACTIVE on the right plan", async () => {
  const ent = await resolveEntitlement("paid@example.com", {
    getSubscriptionByEmail: dodoStore({ "paid@example.com": DODO_ACTIVE }),
    stripeEnabled: true,
    ...stripeStubs({ customers: [] }), // Stripe knows nothing about them
    planForPriceId,
  });
  assertWellFormed(ent);
  assert.equal(ent.active, true, "Dodo payer must be entitled");
  assert.equal(ent.plan, "assistant");
  assert.equal(ent.status, "active");
  assert.equal(ent.customerId, "cus_dodo_abc123", "real Dodo customer id, never a faked Stripe one");
  assert.equal(ent.priceId, null, "Dodo has no Stripe price id");
});

test("(a2) email is normalised — session casing/whitespace still resolves", async () => {
  const ent = await resolveEntitlement("  PAID@Example.com  ", {
    getSubscriptionByEmail: dodoStore({ "paid@example.com": DODO_ACTIVE }),
  });
  assert.equal(ent.active, true);
});

// ---- (b) Legacy Stripe customer, no Dodo record -------------------------
test("(b) legacy Stripe customer with no Dodo record still resolves ACTIVE (no regression)", async () => {
  const ent = await resolveEntitlement("legacy@example.com", {
    getSubscriptionByEmail: noDodo,
    stripeEnabled: true,
    ...stripeStubs({
      customers: [{ id: "cus_stripe_legacy" }],
      subsByCustomer: { cus_stripe_legacy: [stripeSub("active", "price_studio_7900")] },
    }),
    planForPriceId,
  });
  assertWellFormed(ent);
  assert.equal(ent.active, true);
  assert.equal(ent.plan, "studio");
  assert.equal(ent.status, "active");
  assert.equal(ent.priceId, "price_studio_7900");
  assert.equal(ent.customerId, "cus_stripe_legacy");
});

test("(b2) legacy Stripe: trialing/past_due entitle; every customer row is checked", async () => {
  for (const status of ["active", "trialing", "past_due"]) {
    const ent = await resolveEntitlement("legacy@example.com", {
      getSubscriptionByEmail: noDodo,
      stripeEnabled: true,
      ...stripeStubs({
        customers: [{ id: "cus_empty" }, { id: "cus_real" }],
        subsByCustomer: { cus_empty: [], cus_real: [stripeSub(status, "price_companion_1499")] },
      }),
      planForPriceId,
    });
    assert.equal(ent.active, true, status + " must entitle");
    assert.equal(ent.customerId, "cus_real", "second customer row is reached");
    assert.equal(ent.plan, "companion");
  }
});

test("(b3) legacy Stripe customer, cancelled sub -> inactive but customerId preserved", async () => {
  const ent = await resolveEntitlement("lapsed@example.com", {
    getSubscriptionByEmail: noDodo,
    stripeEnabled: true,
    ...stripeStubs({
      customers: [{ id: "cus_lapsed" }],
      subsByCustomer: { cus_lapsed: [stripeSub("canceled", "price_studio_7900")] },
    }),
    planForPriceId,
  });
  assertWellFormed(ent);
  assert.equal(ent.active, false);
  assert.equal(ent.customerId, "cus_lapsed", "preserves the pre-existing behaviour exactly");
});

// ---- (c) Neither ---------------------------------------------------------
test("(c) no Dodo record and no Stripe customer -> inactive, well-formed, no throw", async () => {
  const ent = await resolveEntitlement("nobody@example.com", {
    getSubscriptionByEmail: noDodo,
    stripeEnabled: true,
    ...stripeStubs({ customers: [] }),
    planForPriceId,
  });
  assertWellFormed(ent);
  assert.equal(ent.active, false);
  assert.deepEqual(ent, { active: false, status: null, plan: null, priceId: null, customerId: null });
});

test("(c2) empty/invalid email short-circuits to a well-formed inactive answer", async () => {
  for (const bad of ["", "   ", null, undefined]) {
    const ent = await resolveEntitlement(bad, { getSubscriptionByEmail: dodoStore({}) });
    assertWellFormed(ent);
    assert.equal(ent.active, false);
  }
});

// ---- (d) Dodo lookup throws ---------------------------------------------
test("(d) a THROWING Dodo lookup never escapes; Stripe still answers", async () => {
  const seen = [];
  const ent = await resolveEntitlement("legacy@example.com", {
    getSubscriptionByEmail: dodoThrows(),
    stripeEnabled: true,
    ...stripeStubs({
      customers: [{ id: "cus_stripe_legacy" }],
      subsByCustomer: { cus_stripe_legacy: [stripeSub("active", "price_studio_7900")] },
    }),
    planForPriceId,
    onError: (source, err) => seen.push([source, String(err)]),
  });
  assertWellFormed(ent);
  assert.equal(ent.active, true, "a broken Dodo store must not cost a legacy customer access");
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], "dodo");
});

test("(d2) BOTH lookups throw -> safe inactive entitlement, still no unhandled exception", async () => {
  const seen = [];
  const ent = await resolveEntitlement("someone@example.com", {
    getSubscriptionByEmail: dodoThrows(),
    stripeEnabled: true,
    listCustomers: async () => {
      throw new Error("stripe 500");
    },
    listSubscriptions: async () => [],
    planForPriceId,
    onError: (source) => seen.push(source),
  });
  assertWellFormed(ent);
  assert.equal(ent.active, false);
  assert.deepEqual(seen, ["dodo", "stripe"]);
});

// ---- (e) THE TRAP: Stripe unconfigured, Dodo record present -------------
test("(e) TRAP: Stripe UNCONFIGURED but a Dodo record exists -> STILL RESOLVES ACTIVE", async () => {
  const ent = await resolveEntitlement("paid@example.com", {
    getSubscriptionByEmail: dodoStore({ "paid@example.com": DODO_ACTIVE }),
    stripeEnabled: false, // paymentsConfigured() === false — the production posture today
    listCustomers: async () => {
      throw new Error("stripe() would throw: Missing STRIPE_SECRET_KEY");
    },
    listSubscriptions: async () => {
      throw new Error("stripe() would throw: Missing STRIPE_SECRET_KEY");
    },
    planForPriceId,
  });
  assertWellFormed(ent);
  assert.equal(ent.active, true, "THIS is the bug: Stripe config must not gate the Dodo path");
  assert.equal(ent.plan, "assistant");
});

test("(e2) Stripe unconfigured and no Dodo record -> inactive, and Stripe is never called", async () => {
  let called = false;
  const ent = await resolveEntitlement("nobody@example.com", {
    getSubscriptionByEmail: noDodo,
    stripeEnabled: false,
    listCustomers: async () => {
      called = true;
      return [];
    },
    listSubscriptions: async () => [],
  });
  assertWellFormed(ent);
  assert.equal(ent.active, false);
  assert.equal(called, false, "must not touch Stripe when it is switched off");
});

// ---- unpaid / cancelled Dodo records must NOT entitle -------------------
test("unpaid Dodo statuses (pending/bound) and cancelled do NOT entitle", async () => {
  for (const status of ["pending", "bound", "cancelled"]) {
    const ent = await resolveEntitlement("x@example.com", {
      getSubscriptionByEmail: dodoStore({
        "x@example.com": {
          customerId: "cus_d",
          rec: { ...DODO_ACTIVE.rec, email: "x@example.com", status },
        },
      }),
      stripeEnabled: false,
    });
    assertWellFormed(ent);
    assert.equal(ent.active, false, status + " must never grant access");
    assert.equal(ent.status, status, "the real status is still reported");
  }
});

test("a cancelled Dodo record does not mask a live legacy Stripe subscription", async () => {
  const ent = await resolveEntitlement("both@example.com", {
    getSubscriptionByEmail: dodoStore({
      "both@example.com": {
        customerId: "cus_d",
        rec: { ...DODO_ACTIVE.rec, email: "both@example.com", status: "cancelled" },
      },
    }),
    stripeEnabled: true,
    ...stripeStubs({
      customers: [{ id: "cus_stripe_legacy" }],
      subsByCustomer: { cus_stripe_legacy: [stripeSub("active", "price_studio_7900")] },
    }),
    planForPriceId,
  });
  assert.equal(ent.active, true);
  assert.equal(ent.plan, "studio");
});

// ---- plan slug hygiene ---------------------------------------------------
test("an unrecognised plan slug resolves to null, never a guessed tier", () => {
  assert.equal(paidPlanOrNull("enterprise"), null);
  assert.equal(paidPlanOrNull(undefined), null);
  assert.equal(paidPlanOrNull("studio"), "studio");
  const ent = entitlementFromDodoRecord({ customerId: "c", rec: { plan: "enterprise", status: "active" } });
  assert.equal(ent.plan, null, "unknown tier must not be invented");
  assert.equal(ent.active, true, "but they HAVE paid — access is not denied over a slug we cannot name");
});

test("entitlementFromDodoRecord returns null when there is no record at all", () => {
  assert.equal(entitlementFromDodoRecord(null), null);
  assert.equal(entitlementFromDodoRecord(undefined), null);
  assert.equal(entitlementFromDodoRecord({ customerId: "c" }), null);
});
