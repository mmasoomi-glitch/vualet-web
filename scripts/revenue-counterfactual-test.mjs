/**
 * COUNTERFACTUAL suite — proves the other revenue tests are not worthless.
 *
 * Standing project rule (ledger gotchas #138/#139): a test that would still
 * pass with the fix removed proves nothing. So this file checks out the OLD
 * revision of each route straight from git, runs the SAME security assertions
 * against it, and requires them to FAIL. If any assertion here stops failing,
 * the corresponding test in the other files has stopped detecting the fix.
 *
 * The old revisions are extracted with `git show` into a temp directory at run
 * time — nothing under src/ is ever touched or overwritten, and the suite is
 * reproducible on any clone.
 *
 * Counterfactual bases (deliberately NOT all the same commit):
 *   portal anti-IDOR   4ed719e  — the branch parent; the fix is new on this branch
 *   begin rate limit   4ed719e  — same, limiter is new on this branch
 *   checkout promo     4ed719e  — same, promo handling is new on this branch
 *   checkout binding   f889ee5  — the phone/channel/consent gate on the PAID
 *                                path (gotchas#256) is new on this branch, so
 *                                the branch tip before it is the honest base.
 *   checkout email     1ade97d  — the email guard is NOT new on this branch. It
 *                                 landed earlier in 19232a4, so 4ed719e already
 *                                 has it and is useless as a counterfactual
 *                                 base. 1ade97d is 19232a4's real parent, the
 *                                 last revision genuinely without the guard.
 *
 * Run: npm run test:counterfactual
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ROOT, loadRoute, jsonRequest, readJson, env, netCalls, resetNet, scriptFetch,
} from "./route-harness/index.mjs";
import * as stripeStub from "./route-harness/stubs/stripe-sdk.mjs";
import { __cookies } from "./route-harness/stubs/next-headers.mjs";

const PARENT = "4ed719e";        // branch parent: portal / begin / promo baseline
const PRE_EMAIL_GUARD = "1ade97d"; // last revision before 19232a4 added the guard
const PRE_BINDING = "f889ee5";     // last revision before the paid path collected phone/channel/consent

let OLD = {};

before(() => {
  const dir = mkdtempSync(path.join(tmpdir(), "mira-counterfactual-"));
  const extract = (name, rev, file) => {
    const src = execFileSync("git", ["show", `${rev}:${file}`], { cwd: ROOT, encoding: "utf8" });
    const dest = path.join(dir, `${name}.ts`);
    writeFileSync(dest, src);
    OLD[name] = { path: dest, src, rev };
  };
  extract("portal", PARENT, "src/app/api/portal/route.ts");
  extract("begin", PARENT, "src/app/api/begin/route.ts");
  extract("checkoutPromo", PARENT, "src/app/api/checkout/route.ts");
  extract("checkoutEmail", PRE_EMAIL_GUARD, "src/app/api/checkout/route.ts");
  extract("checkoutBinding", PRE_BINDING, "src/app/api/checkout/route.ts");
});

/**
 * Require that `fn` — an assertion copied from the real test suite — FAILS when
 * pointed at the old code. Anything else means the test cannot tell the fixed
 * code from the broken code.
 */
async function mustFailAgainstOldCode(what, fn) {
  let caught = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(
    caught,
    `COUNTERFACTUAL BROKEN — "${what}" PASSED against the old, unfixed code. ` +
      `That test does not actually detect the fix and must be strengthened.`,
  );
  assert.ok(
    caught instanceof assert.AssertionError,
    `expected an assertion failure for "${what}", but got a different error: ${caught?.message}`,
  );
  return caught;
}

const DODO_ARMED = {
  DODO_API_KEY: "dummy_dodo_key_not_real",
  DODO_PAYMENTS_LIVE: "1",
  DODO_PRODUCT_COMPANION: "prod_dummy_companion",
};
const STRIPE_ARMED = {
  STRIPE_SECRET_KEY: "sk_test_dummy_not_real",
  STRIPE_PRICE_COMPANION: "price_dummy_companion",
};
const PAYMENTS_ON = { STRIPE_SECRET_KEY: "sk_test_dummy_not_real", PAYMENTS_LIVE: "1" };

const dodoReplies = () => scriptFetch(async () => new Response(
  JSON.stringify({ payment_link: "https://pay.dodo.test/OLD" }),
  { status: 200, headers: { "content-type": "application/json" } },
));

beforeEach(() => {
  env();
  resetNet();
  stripeStub.reset();
  __cookies.clear();
});

// ── (c) ANTI-IDOR counterfactual ───────────────────────────────────────────

test("CF-c1: the OLD portal really is an IDOR — an ANONYMOUS caller opens a stranger's portal", async () => {
  env(PAYMENTS_ON);
  const { POST } = await loadRoute(OLD.portal.path, { fresh: true });
  const store = await loadRoute("src/lib/store.ts");

  const VICTIM = "cus_VICTIM_CF_0001";
  await store.putSubscription(VICTIM, {
    token: "tok_v", plan: "companion", email: "victim@example.com",
    status: "active", customerId: VICTIM, createdAt: new Date().toISOString(),
  });

  stripeStub.config.portalSession = { url: "https://billing.stripe.test/session/VICTIM" };
  __cookies.clear(); // NO session whatsoever

  const res = await POST(jsonRequest({ customer_id: VICTIM })).then(readJson);

  // This is the vulnerability, demonstrated rather than asserted away.
  assert.equal(res.status, 200, "the old route hands out a portal with no authentication at all");
  assert.equal(res.body.url, "https://billing.stripe.test/session/VICTIM");
  const created = stripeStub.calls.filter((c) => c.method === "billingPortal.sessions.create");
  assert.equal(created.length, 1);
  assert.equal(
    created[0].args[0].customer, VICTIM,
    "the OLD route opened the VICTIM's portal purely from a body-supplied id",
  );
});

test("CF-c2: the anti-IDOR assertion FAILS against the old portal", async () => {
  env(PAYMENTS_ON);
  const { POST } = await loadRoute(OLD.portal.path, { fresh: true });
  const store = await loadRoute("src/lib/store.ts");
  const session = await loadRoute("src/lib/session.ts");

  const VICTIM = "cus_VICTIM_CF_0002";
  const ATTACKER = "cus_ATTACKER_CF_0002";
  for (const [id, email] of [[VICTIM, "victim2@example.com"], [ATTACKER, "attacker2@example.com"]]) {
    await store.putSubscription(id, {
      token: `tok_${id}`, plan: "companion", email,
      status: "active", customerId: id, createdAt: new Date().toISOString(),
    });
  }

  __cookies.set(session.SESSION_COOKIE, session.createSessionToken("attacker2@example.com"));
  stripeStub.config.portalSession = { url: "https://billing.stripe.test/session/X" };

  await POST(jsonRequest({ customer_id: VICTIM })).then(readJson);

  await mustFailAgainstOldCode(
    "portal resolves the customer from the SESSION, never the body",
    () => {
      const created = stripeStub.calls.filter((c) => c.method === "billingPortal.sessions.create");
      assert.equal(created[0].args[0].customer, ATTACKER,
        "the portal must be for the SESSION owner, never the body-supplied id");
    },
  );
});

test("CF-c3: the 'no session -> 401' assertion FAILS against the old portal", async () => {
  env(PAYMENTS_ON);
  const { POST } = await loadRoute(OLD.portal.path, { fresh: true });
  __cookies.clear();

  const res = await POST(jsonRequest({ customer_id: "cus_ANY" })).then(readJson);
  await mustFailAgainstOldCode("an unauthenticated portal request is 401", () => {
    assert.equal(res.status, 401);
  });
  assert.notEqual(res.status, 401, `old route answered ${res.status}, never 401 — it has no concept of a session`);
});

test("CF-c4: the STRUCTURAL assertion FAILS against the old portal (it does take a Request)", async () => {
  const { POST } = await loadRoute(OLD.portal.path, { fresh: true });
  await mustFailAgainstOldCode("POST() declares zero parameters", () => {
    assert.equal(POST.length, 0);
  });
  assert.equal(POST.length, 1, "the old handler takes a Request — that is exactly how the body got trusted");
  assert.match(POST.toString(), /customer_id/, "and it really does read customer_id from it");
});

// ── (a) email guard counterfactual ─────────────────────────────────────────

test("CF-a1: the OLD checkout (pre-19232a4) accepts a MISSING email and charges anyway", async () => {
  env(DODO_ARMED);
  dodoReplies();
  const { POST } = await loadRoute(OLD.checkoutEmail.path, { fresh: true });

  const res = await POST(jsonRequest({ plan: "companion" })).then(readJson);

  assert.equal(res.status, 200, "the old route happily created a checkout with no email");
  assert.equal(netCalls.length, 1, "and it really did call the payment provider");
  const sent = JSON.parse(netCalls[0].body);
  assert.equal(
    sent.customer.email, "guest@vualet.com",
    "collapsing every anonymous buyer into the shared guest identity — the defect",
  );
});

test("CF-a2: the 'missing email -> 400 email_required' assertion FAILS against the old checkout", async () => {
  env(DODO_ARMED);
  dodoReplies();
  const { POST } = await loadRoute(OLD.checkoutEmail.path, { fresh: true });

  for (const email of [undefined, "", "   "]) {
    const res = await POST(jsonRequest({ plan: "companion", email })).then(readJson);
    await mustFailAgainstOldCode(`missing email (${JSON.stringify(email)}) is 400 email_required`, () => {
      assert.equal(res.status, 400);
      assert.equal(res.body.error, "email_required");
    });
  }
});

test("CF-a3: the 'malformed email -> 400' assertion FAILS against the old checkout", async () => {
  env(DODO_ARMED);
  dodoReplies();
  const { POST } = await loadRoute(OLD.checkoutEmail.path, { fresh: true });

  const res = await POST(jsonRequest({ plan: "companion", email: "notanemail" })).then(readJson);
  await mustFailAgainstOldCode("a malformed email is rejected 400", () => {
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "email_required");
  });
  assert.equal(res.status, 200, "the old route sent 'notanemail' straight to the provider");
});

test("CF-a4: the '>200 char email -> 400' assertion FAILS against the old checkout", async () => {
  env(DODO_ARMED);
  dodoReplies();
  const { POST } = await loadRoute(OLD.checkoutEmail.path, { fresh: true });

  const over = "a".repeat(189) + "@example.com"; // 201 chars
  const res = await POST(jsonRequest({ plan: "companion", email: over })).then(readJson);
  await mustFailAgainstOldCode("an over-long email is rejected 400", () => {
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "email_required");
  });
});

test("CF-a5: HONEST NOTE — the email guard is NOT new on this branch (4ed719e already has it)", async () => {
  env(DODO_ARMED);
  const { POST } = await loadRoute(OLD.checkoutPromo.path, { fresh: true }); // 4ed719e
  const res = await POST(jsonRequest({ plan: "companion" })).then(readJson);
  assert.equal(res.status, 400, "4ed719e ALREADY rejects a missing email");
  assert.equal(res.body.error, "email_required");
  assert.match(OLD.checkoutPromo.src, /email_required/);
  // Recorded so nobody credits this branch with a fix it did not make.
});

// ── (b) promo counterfactual ───────────────────────────────────────────────

test("CF-b1: the OLD checkout IGNORES promoCode and charges FULL price — the actual defect", async () => {
  env({ ...DODO_ARMED, ...STRIPE_ARMED, PROMO_CODES_ENABLED: "1" });
  dodoReplies();
  stripeStub.config.promotionCodes = {
    data: [{ id: "promo_100", code: "FREEBIE", active: true, coupon: { percent_off: 100, valid: true } }],
  };
  const { POST } = await loadRoute(OLD.checkoutPromo.path, { fresh: true });

  const res = await POST(jsonRequest({
    plan: "companion", email: "freeuser@example.com", promoCode: "FREEBIE",
  })).then(readJson);

  assert.equal(res.status, 200);
  assert.equal(res.body.url, "https://pay.dodo.test/OLD", "the customer is sent to PAY");
  assert.equal(res.body.zeroCharge, undefined, "no zero-charge concept exists in the old route");
  assert.equal(netCalls.length, 1, "a 100%-off code still produced a full-price payment link");
  assert.equal(stripeStub.calls.length, 0, "the code was never even validated");
});

test("CF-b2: the '100%-off makes NO Dodo call' assertion FAILS against the old checkout", async () => {
  env({ ...DODO_ARMED, ...STRIPE_ARMED, PROMO_CODES_ENABLED: "1" });
  dodoReplies();
  stripeStub.config.promotionCodes = {
    data: [{ id: "promo_100", code: "FREEBIE", active: true, coupon: { percent_off: 100, valid: true } }],
  };
  const { POST } = await loadRoute(OLD.checkoutPromo.path, { fresh: true });
  const res = await POST(jsonRequest({
    plan: "companion", email: "freeuser@example.com", promoCode: "FREEBIE",
  })).then(readJson);

  await mustFailAgainstOldCode("a 100%-off order never calls Dodo and reports zeroCharge", () => {
    assert.equal(netCalls.length, 0, "a 100%-off order must never call Dodo");
    assert.equal(res.body.zeroCharge, true);
  });
});

test("CF-b3: the 'partial discount -> 409' assertion FAILS against the old checkout", async () => {
  env({ ...DODO_ARMED, ...STRIPE_ARMED, PROMO_CODES_ENABLED: "1" });
  dodoReplies();
  stripeStub.config.promotionCodes = {
    data: [{ id: "promo_30", code: "SAVE30", active: true, coupon: { percent_off: 30, valid: true } }],
  };
  const { POST } = await loadRoute(OLD.checkoutPromo.path, { fresh: true });
  const res = await POST(jsonRequest({
    plan: "companion", email: "buyer@example.com", promoCode: "SAVE30",
  })).then(readJson);

  await mustFailAgainstOldCode("a partial discount is refused 409 and nothing is charged", () => {
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "partial_discount_unsupported");
    assert.equal(netCalls.length, 0);
  });
  assert.equal(res.status, 200, "the old route charged the customer full price instead");
});

test("CF-b4: the 'kill switch -> 503 promo_unavailable' assertion FAILS against the old checkout", async () => {
  env({ ...DODO_ARMED, ...STRIPE_ARMED }); // PROMO_CODES_ENABLED unset
  dodoReplies();
  const { POST } = await loadRoute(OLD.checkoutPromo.path, { fresh: true });
  const res = await POST(jsonRequest({
    plan: "companion", email: "buyer@example.com", promoCode: "FREEBIE",
  })).then(readJson);

  await mustFailAgainstOldCode("a promo code with the kill switch off is 503 promo_unavailable", () => {
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "promo_unavailable");
  });
});

// ── (d) rate-limit counterfactual ──────────────────────────────────────────

test("CF-d1: the OLD /api/begin has NO limiter — the 6th, 20th and 50th calls all succeed", async () => {
  env();
  const { POST } = await loadRoute(OLD.begin.path, { fresh: true });
  const ip = "203.0.113.250";
  const call = () => POST(jsonRequest({ plan: "trial" }, { headers: { "x-forwarded-for": ip } })).then(readJson);

  for (let i = 1; i <= 50; i++) {
    const { status } = await call();
    assert.equal(status, 200, `old route call ${i} should still succeed — it is an open faucet`);
  }
});

test("CF-d2: the '6th call -> 429' assertion FAILS against the old begin route", async () => {
  env();
  const { POST } = await loadRoute(OLD.begin.path, { fresh: true });
  const ip = "203.0.113.251";
  const call = () => POST(jsonRequest({ plan: "trial" }, { headers: { "x-forwarded-for": ip } })).then(readJson);

  for (let i = 0; i < 5; i++) await call();
  const sixth = await call();

  await mustFailAgainstOldCode("the 6th call from one IP is refused 429", () => {
    assert.equal(sixth.status, 429);
    assert.equal(sixth.body.error, "rate_limited");
  });
  assert.equal(sixth.status, 200, "the old route provisioned yet another tenant");
});

// ── (e) BINDING-AT-PURCHASE counterfactual ─────────────────────────────────
//
// gotchas#256. The claim being counter-checked: /api/checkout now refuses a
// paid order that carries no number, no channel or no gate-C1 consent, and
// refuses it BEFORE any provider is called. If the section (e) tests in
// revenue-checkout-test.mjs would also pass against the route as it stood
// before the fix, they are decoration. They must not.

const CONSENT_OK = {
  unofficialAutomation: true,
  banRisk: true,
  ownAccountReplies: true,
};

test("CF-e1: the OLD checkout takes the money and leaves the customer UNBINDABLE — the defect", async () => {
  env(DODO_ARMED);
  dodoReplies();
  const { POST } = await loadRoute(OLD.checkoutBinding.path, { fresh: true });
  const store = await loadRoute("src/lib/store.ts");

  // No phone. No channel. No consent. Nothing but an email.
  const res = await POST(jsonRequest({ plan: "companion", email: "unbindable@example.com" })).then(readJson);

  assert.equal(res.status, 200, "the old route happily charged for a plan it could never connect");
  assert.equal(netCalls.length, 1, "and it really did reach the payment provider");

  const token = new URL(JSON.parse(netCalls[0].body).return_url).searchParams.get("token");
  const rec = await store.getConnect(token);
  assert.ok(rec, "a connect record was written...");
  assert.equal(rec.phone, undefined, "...with no number to bind to");
  assert.equal(rec.channel, undefined, "...no channel");
  assert.equal(rec.consent, undefined, "...and no proof the ban-risk notice was ever shown");
});

test("CF-e2: the 'missing consent -> 400 consent_required' assertion FAILS against the old checkout", async () => {
  env(DODO_ARMED);
  dodoReplies();
  const { POST } = await loadRoute(OLD.checkoutBinding.path, { fresh: true });

  for (const consent of [undefined, {}, { ...CONSENT_OK, banRisk: false }]) {
    const res = await POST(jsonRequest({
      plan: "companion", email: "buyer@example.com", phone: "0501234567", consent,
    })).then(readJson);

    await mustFailAgainstOldCode(`consent=${JSON.stringify(consent)} is refused 400`, () => {
      assert.equal(res.status, 400);
      assert.equal(res.body.error, "consent_required");
    });
    assert.equal(res.status, 200, "the old route charged without any consent at all");
  }
});

test("CF-e3: the 'invalid phone -> 400 invalid_phone, no charge' assertion FAILS against the old checkout", async () => {
  env(DODO_ARMED);
  dodoReplies();
  const { POST } = await loadRoute(OLD.checkoutBinding.path, { fresh: true });

  const res = await POST(jsonRequest({
    plan: "companion", email: "buyer@example.com", phone: "abcdef", consent: CONSENT_OK,
  })).then(readJson);

  await mustFailAgainstOldCode("a junk phone is refused 400 invalid_phone", () => {
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid_phone");
  });
  await mustFailAgainstOldCode("a junk phone reaches no provider", () => {
    assert.equal(netCalls.length, 0);
  });
  assert.equal(netCalls.length, 1, "the old route charged and discarded the number entirely");
});

test("CF-e4: the 'unknown channel -> 400 invalid_channel' assertion FAILS against the old checkout", async () => {
  env(DODO_ARMED);
  dodoReplies();
  const { POST } = await loadRoute(OLD.checkoutBinding.path, { fresh: true });

  const res = await POST(jsonRequest({
    plan: "companion", email: "buyer@example.com", channel: "signal",
    phone: "0501234567", consent: CONSENT_OK,
  })).then(readJson);

  await mustFailAgainstOldCode("an unknown channel is refused 400", () => {
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid_channel");
  });
  assert.equal(res.status, 200, "the old route had no concept of a channel to refuse");
});

test("CF-e5: the 'phone stored as E.164' assertion FAILS against the old checkout", async () => {
  env(DODO_ARMED);
  dodoReplies();
  const { POST } = await loadRoute(OLD.checkoutBinding.path, { fresh: true });
  const store = await loadRoute("src/lib/store.ts");

  await POST(jsonRequest({
    plan: "companion", email: "e164@example.com", phone: "050 123 4567", consent: CONSENT_OK,
  })).then(readJson);

  const token = new URL(JSON.parse(netCalls[0].body).return_url).searchParams.get("token");
  const rec = await store.getConnect(token);

  await mustFailAgainstOldCode("the normalised E.164 is persisted on the record", () => {
    assert.equal(rec.phone, "+971501234567");
  });
  assert.equal(rec.phone, undefined, "the old route dropped the number on the floor");
});

test("CF-e6: the 'zero-charge order is bound too' assertion FAILS against the old checkout", async () => {
  env({ ...DODO_ARMED, ...STRIPE_ARMED, PROMO_CODES_ENABLED: "1" });
  stripeStub.config.promotionCodes = {
    data: [{ id: "promo_100", code: "FREEBIE", active: true, coupon: { percent_off: 100, valid: true } }],
  };
  stripeStub.config.price = { unit_amount: 1499, currency: "usd" };
  const { POST } = await loadRoute(OLD.checkoutBinding.path, { fresh: true });
  const store = await loadRoute("src/lib/store.ts");

  // A comped order with everything supplied — the old route still recorded none of it.
  const res = await POST(jsonRequest({
    plan: "companion", email: "comped@example.com", promoCode: "FREEBIE",
    channel: "whatsapp", phone: "050 123 4567", consent: CONSENT_OK,
  })).then(readJson);
  assert.equal(res.body.zeroCharge, true);

  const rec = await store.getConnect(res.body.token);
  await mustFailAgainstOldCode("a comped customer is as bindable as a paying one", () => {
    assert.equal(rec.phone, "+971501234567");
    assert.equal(rec.channel, "whatsapp");
    assert.equal(rec.consent.banRisk, true);
  });
});
