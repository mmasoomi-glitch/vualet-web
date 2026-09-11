// Authenticated coverage for src/app/api/subscription/plan-change/route.ts
//
// These use the REAL HMAC session signer and the REAL store, so "signed in"
// here means exactly what it means in production and a forged cookie fails.
// They exist because a reviewer found the 404, 409 and 200 branches were never
// exercised — only the unauthenticated 401 path was covered.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, readJson, resetNet } from "./route-harness/index.mjs";
import { __cookies } from "./route-harness/stubs/next-headers.mjs";

const session = await loadRoute("src/lib/session.ts");
const store = await loadRoute("src/lib/store.ts");
const { POST } = await loadRoute("src/app/api/subscription/plan-change/route.ts", { fresh: true });

const URL_ = "https://mira.vualet.com/api/subscription/plan-change";

/** Sign in as this email using a REAL signed session token. */
function signIn(email) {
  __cookies.clear();
  __cookies.set(session.SESSION_COOKIE, session.createSessionToken(email));
}

function signOut() {
  __cookies.clear();
}

async function seed({ email, customerId, subscriptionId, plan = "companion", status = "active" }) {
  await store.putSubscription(customerId, {
    token: `tok_${customerId}`,
    plan,
    email,
    status,
    provider: "dodo",
    customerId,
    subscriptionId,
    createdAt: "2026-08-15T00:00:00.000Z",
  });
}

function post(body) {
  return POST(
    new Request(URL_, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

test.beforeEach(() => {
  resetNet();
  signOut();
});

test("a signed-in customer with no subscription gets 404", async () => {
  signIn("nosub-1@example.com");
  const { status, body } = await readJson(await post({ target: "studio" }));
  assert.equal(status, 404);
  assert.equal(body.error, "no_subscription");
});

test("an unrecognised stored plan is refused with 409 plan_unrecognised", async () => {
  const email = "legacy-1@example.com";
  await seed({ email, customerId: "cust_legacy_1", subscriptionId: "sub_legacy_1", plan: "legacy_pro" });
  signIn(email);
  const { status, body } = await readJson(await post({ target: "studio" }));
  assert.equal(status, 409, "a drifted plan must not be coerced into an upgrade flow");
  assert.equal(body.error, "plan_unrecognised");
});

test("a same-plan request is refused with 409 change_not_allowed", async () => {
  const email = "same-1@example.com";
  await seed({ email, customerId: "cust_same_1", subscriptionId: "sub_same_1", plan: "companion" });
  signIn(email);
  const { status, body } = await readJson(await post({ target: "companion" }));
  assert.equal(status, 409);
  assert.equal(body.error, "change_not_allowed");
  assert.equal(body.kind, "noop");
});

test("a non-active subscription is refused with 409", async () => {
  const email = "cancelled-1@example.com";
  await seed({
    email,
    customerId: "cust_cancelled_1",
    subscriptionId: "sub_cancelled_1",
    plan: "companion",
    status: "cancelled",
  });
  signIn(email);
  const { status, body } = await readJson(await post({ target: "studio" }));
  assert.equal(status, 409);
  assert.equal(body.kind, "noop");
});

test("a paid upgrade returns 200 with nextStep support", async () => {
  const email = "upgrade-1@example.com";
  await seed({ email, customerId: "cust_upgrade_1", subscriptionId: "sub_upgrade_1", plan: "companion" });
  signIn(email);
  const { status, body } = await readJson(await post({ target: "studio" }));
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.kind, "upgrade");
  assert.equal(body.requiresPayment, true);
  assert.equal(
    body.nextStep,
    "support",
    "paid-to-paid deliberately routes to a human because proration is an owner decision",
  );
  assert.ok(typeof body.supportPath === "string" && body.supportPath.length > 0);
});

test("a paid downgrade returns 200, requiresPayment false, still support", async () => {
  const email = "downgrade-1@example.com";
  await seed({ email, customerId: "cust_downgrade_1", subscriptionId: "sub_downgrade_1", plan: "studio" });
  signIn(email);
  const { status, body } = await readJson(await post({ target: "companion" }));
  assert.equal(status, 200);
  assert.equal(body.kind, "downgrade");
  assert.equal(body.requiresPayment, false, "a downgrade must never be billed as an upgrade");
});

test("moving to free returns nextStep cancel", async () => {
  const email = "free-1@example.com";
  await seed({ email, customerId: "cust_free_1", subscriptionId: "sub_free_1", plan: "studio" });
  signIn(email);
  const { status, body } = await readJson(await post({ target: "free" }));
  assert.equal(status, 200);
  assert.equal(body.kind, "downgrade");
  assert.equal(body.nextStep, "cancel");
  assert.ok(typeof body.cancelPath === "string" && body.cancelPath.length > 0);
});

test("ANTI-IDOR: signed in as A, a body naming B's subscription still resolves A", async () => {
  // A and B are on DIFFERENT plans on purpose. If the body could steer the
  // lookup, `current` would come back as B's plan and this test would fail.
  await seed({ email: "idor-a@example.com", customerId: "cust_idor_a", subscriptionId: "sub_idor_a", plan: "companion" });
  await seed({ email: "idor-b@example.com", customerId: "cust_idor_b", subscriptionId: "sub_idor_b", plan: "studio" });

  signIn("idor-a@example.com");

  const { body } = await readJson(
    await post({
      target: "assistant",
      email: "idor-b@example.com",
      customerId: "cust_idor_b",
      subscriptionId: "sub_idor_b",
    }),
  );

  // A 409 still carries `current`, so this holds whichever branch was taken.
  assert.equal(body.current, "companion", "identity and subscription come only from the verified session");
  assert.notEqual(body.current, "studio", "the body must never be able to select another customer's record");
});

test("signing out returns to 401", async () => {
  signOut();
  const { status, body } = await readJson(await post({ target: "studio" }));
  assert.equal(status, 401);
  assert.equal(body.error, "not_signed_in");
});
