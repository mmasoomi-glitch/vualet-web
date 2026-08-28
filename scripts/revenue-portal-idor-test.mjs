/**
 * /api/portal — ANTI-IDOR tests against the REAL route handler.
 *
 * The old route (git 4ed719e) took `customer_id` from the request body and
 * opened that customer's Stripe billing portal for anyone who could name a
 * customer id we had a record for. This suite proves the current route cannot
 * do that: the subscription is resolved ONLY from a cryptographically verified
 * session cookie.
 *
 * Everything here is production code except three boundaries: the `stripe` npm
 * SDK, `next/headers` cookies(), and global fetch. In particular src/lib/session.ts
 * runs verbatim — sessions are minted with the real HMAC signer, so "signed in"
 * in this test means exactly what it means in production, and a forged cookie
 * really does fail verification.
 *
 * Run: npm run test:portal-idor
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadRoute, jsonRequest, readJson, env, resetNet } from "./route-harness/index.mjs";
import * as stripeStub from "./route-harness/stubs/stripe-sdk.mjs";
import { __cookies } from "./route-harness/stubs/next-headers.mjs";

const { POST } = await loadRoute("src/app/api/portal/route.ts");
const store = await loadRoute("src/lib/store.ts");
const session = await loadRoute("src/lib/session.ts");

const PAYMENTS_ON = { STRIPE_SECRET_KEY: "sk_test_dummy_not_real", PAYMENTS_LIVE: "1" };

const VICTIM = { email: "victim@example.com", customerId: "cus_VICTIM_0001" };
const ATTACKER = { email: "attacker@example.com", customerId: "cus_ATTACKER_9999" };

/** Sign in as this email using a REAL signed session token. */
function signIn(email) {
  __cookies.clear();
  __cookies.set(session.SESSION_COOKIE, session.createSessionToken(email));
}

function signOut() {
  __cookies.clear();
}

/** Seed a DODO-era subscription: same shape, deliberately NO legacy customerId
 * field - that Stripe-era marker is what routes a record down the Stripe
 * portal branch, and a Dodo-era record lacks it. */
async function seedDodoOnlyCustomer({ email, customerId }) {
  await store.putSubscription(customerId, {
    token: `tok_${customerId}`,
    plan: "companion",
    email,
    status: "active",
    createdAt: new Date().toISOString(),
  });
}

/** Seed a Stripe-era subscription through the real store API. */
async function seedStripeCustomer({ email, customerId }) {
  await store.putSubscription(customerId, {
    token: `tok_${customerId}`,
    plan: "companion",
    email,
    status: "active",
    customerId,
    createdAt: new Date().toISOString(),
  });
}

beforeEach(() => {
  env(PAYMENTS_ON);
  resetNet();
  stripeStub.reset();
  signOut();
});

// ── the structural proof ───────────────────────────────────────────────────

test("c: STRUCTURAL — the handler accepts no Request at all, so a body CANNOT be read", () => {
  assert.equal(
    POST.length,
    0,
    "POST() must declare zero parameters: with no Request in scope there is no body to trust",
  );
  const src = POST.toString();
  assert.doesNotMatch(src, /customer_id/, "the handler must not mention customer_id anywhere");
  assert.doesNotMatch(src, /req\.json|request\.json/, "the handler must not parse a request body");
});

// ── the behavioural proof ──────────────────────────────────────────────────

test("c: THE IDOR — attacker's session + VICTIM's customer_id in the body opens the ATTACKER's portal only", async () => {
  await seedStripeCustomer(VICTIM);
  await seedStripeCustomer(ATTACKER);
  signIn(ATTACKER.email);

  stripeStub.config.portalSession = { url: "https://billing.stripe.test/session/RESOLVED" };

  // Every field an attacker might try to smuggle in.
  const res = await POST(jsonRequest({
    customer_id: VICTIM.customerId,
    customerId: VICTIM.customerId,
    email: VICTIM.email,
    subscription_id: "sub_VICTIM",
  })).then(readJson);

  assert.equal(res.status, 200, "the attacker's OWN portal still opens (they are a real customer)");

  const created = stripeStub.calls.filter((c) => c.method === "billingPortal.sessions.create");
  assert.equal(created.length, 1, "exactly one portal session must be created");
  assert.equal(
    created[0].args[0].customer,
    ATTACKER.customerId,
    "THE POINT: the portal must be for the SESSION owner, never the body-supplied id",
  );
  assert.notEqual(
    created[0].args[0].customer,
    VICTIM.customerId,
    "the victim's customer id must never reach Stripe",
  );
});

test("c: the body is ignored ENTIRELY — same result with the body present or absent", async () => {
  await seedStripeCustomer(VICTIM);
  await seedStripeCustomer(ATTACKER);

  signIn(ATTACKER.email);
  const withBody = await POST(jsonRequest({ customer_id: VICTIM.customerId })).then(readJson);
  const withBodyCustomer = stripeStub.calls
    .filter((c) => c.method === "billingPortal.sessions.create").at(-1).args[0].customer;

  stripeStub.reset();
  signIn(ATTACKER.email);
  const noBody = await POST().then(readJson); // called with NO argument at all
  const noBodyCustomer = stripeStub.calls
    .filter((c) => c.method === "billingPortal.sessions.create").at(-1).args[0].customer;

  assert.equal(withBody.status, noBody.status, "status must not depend on the body");
  assert.equal(withBodyCustomer, noBodyCustomer, "the resolved customer must not depend on the body");
  assert.equal(noBodyCustomer, ATTACKER.customerId);
});

test("c: a body-supplied customer_id gives an ANONYMOUS caller nothing -> 401", async () => {
  await seedStripeCustomer(VICTIM);
  signOut();

  const res = await POST(jsonRequest({ customer_id: VICTIM.customerId })).then(readJson);
  assert.equal(res.status, 401, "no session means no portal, whatever the body says");
  assert.equal(res.body.error, "not_signed_in");
  assert.equal(
    stripeStub.calls.filter((c) => c.method === "billingPortal.sessions.create").length,
    0,
    "Stripe must never be called for an unauthenticated request",
  );
});

test("c: a FORGED session cookie is rejected 401 (real HMAC verification runs)", async () => {
  await seedStripeCustomer(VICTIM);

  const real = session.createSessionToken(VICTIM.email);
  const payload = real.slice(0, real.indexOf("."));

  for (const forged of [
    `${payload}.deadbeefdeadbeefdeadbeefdeadbeef`,          // wrong signature
    `${Buffer.from(JSON.stringify({ email: VICTIM.email, exp: 2 ** 40 })).toString("base64url")}.x`,
    "garbage",
    `${payload}`,                                            // signature stripped
  ]) {
    __cookies.clear();
    __cookies.set(session.SESSION_COOKIE, forged);
    const res = await POST(jsonRequest({ customer_id: VICTIM.customerId })).then(readJson);
    assert.equal(res.status, 401, `forged cookie ${forged.slice(0, 24)}… must be rejected`);
  }
  assert.equal(
    stripeStub.calls.filter((c) => c.method === "billingPortal.sessions.create").length,
    0,
  );
});

test("c: an EXPIRED but correctly-signed session is rejected 401", async () => {
  await seedStripeCustomer(VICTIM);
  __cookies.clear();
  __cookies.set(session.SESSION_COOKIE, session.createSessionToken(VICTIM.email, -60));
  const res = await POST(jsonRequest({ customer_id: VICTIM.customerId })).then(readJson);
  assert.equal(res.status, 401);
});

// ── the other documented states ────────────────────────────────────────────

test("c: no session -> 401 not_signed_in", async () => {
  signOut();
  const res = await POST().then(readJson);
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "not_signed_in");
});

test("c: session with NO subscription -> 404 no_subscription", async () => {
  signIn("nosuchcustomer@example.com");
  const res = await POST().then(readJson);
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "no_subscription");
  assert.equal(
    stripeStub.calls.filter((c) => c.method === "billingPortal.sessions.create").length,
    0,
  );
});

test("c: session whose record has NO Stripe customerId -> 409 dodo_managed with a redirect", async () => {
  const email = "dodoera@example.com";
  await store.putSubscription("dodo_sub_777", {
    token: "tok_dodo",
    plan: "companion",
    email,
    status: "active",
    // NOTE: no customerId — this is a Dodo-era record
    createdAt: new Date().toISOString(),
  });
  signIn(email);

  const res = await POST().then(readJson);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "dodo_managed");
  assert.match(res.body.redirect, /\/mira\/account$/, "must redirect to the account page");
  assert.equal(
    stripeStub.calls.filter((c) => c.method === "billingPortal.sessions.create").length,
    0,
    "a Dodo customer must never be sent to the Stripe portal",
  );
});

test("c: a STRIPE-ERA customer with payments unconfigured gets the truthful 503", async () => {
  // The config gate moved: it now guards only the legacy Stripe-era branch,
  // because gating the whole route made the Dodo portal unreachable. Auth
  // therefore runs first, and the 503 needs a signed-in Stripe-era customer.
  env({}); // no STRIPE_SECRET_KEY / PAYMENTS_LIVE
  await seedStripeCustomer(VICTIM);
  signIn(VICTIM.email);
  const res = await POST().then(readJson);
  assert.equal(res.status, 503);
  assert.equal(res.body.error, "not_configured");
});

test("c: PAYMENTS_LIVE must be exactly 1 for the Stripe portal to open", async () => {
  env({ STRIPE_SECRET_KEY: "sk_test_dummy_not_real", PAYMENTS_LIVE: "0" });
  await seedStripeCustomer(VICTIM);
  signIn(VICTIM.email);
  const res = await POST().then(readJson);
  assert.equal(res.status, 503);
});

test("c: a DODO-ERA customer degrades to the account page when no portal session can be minted", async () => {
  // No DODO_API_KEY in tests, so createDodoPortalSession always returns null
  // (it never throws) and the route falls back to the pre-existing 409
  // redirect - deterministic, no network. This pins the fail-safe: a broken
  // portal can never make billing management worse than the account page.
  env({});
  await seedDodoOnlyCustomer(VICTIM);
  signIn(VICTIM.email);
  const res = await POST().then(readJson);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "dodo_managed");
  assert.match(String(res.body.redirect), /\/mira\/account$/);
});

test("c: a Stripe failure is a 502 with a redirect, never a leak or a crash", async () => {
  await seedStripeCustomer(VICTIM);
  signIn(VICTIM.email);
  stripeStub.config.portalSession = new Error("stripe exploded");
  const res = await POST().then(readJson);
  assert.equal(res.status, 502);
  assert.equal(res.body.error, "portal_failed");
  assert.doesNotMatch(JSON.stringify(res.body), /exploded/, "no provider internals in the response");
});

test("c: cross-check — the store itself refuses a record whose email does not match the session", async () => {
  // Defence in depth inside getSubscriptionByEmail: even a poisoned reverse
  // index cannot hand a session someone else's record.
  const kv = store;
  await kv.putSubscription("cus_MISMATCH", {
    token: "tok_m", plan: "companion", email: VICTIM.email,
    status: "active", customerId: "cus_MISMATCH", createdAt: new Date().toISOString(),
  });
  // Point the attacker's email index at the victim's record.
  await kv.kvSet(`mira:subemail:${ATTACKER.email}`, "cus_MISMATCH");

  signIn(ATTACKER.email);
  const res = await POST().then(readJson);
  assert.equal(res.status, 404, "a mismatched record must be refused, not opened");
  assert.equal(
    stripeStub.calls.filter((c) => c.method === "billingPortal.sessions.create").length,
    0,
  );
});
