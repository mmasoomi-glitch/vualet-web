// PAYMENT LIFECYCLE — buy -> cancel -> refund, proven WITHOUT moving money.
//
// Jury #107 constraint 2: the owner offered real card details in a plaintext
// file to prove the payment lifecycle. That was REFUSED (PCI exposure, and an
// agent moving real money autonomously). This suite proves OUR SIDE of the
// Dodo contract instead — the exact same functions, the exact same code path,
// with the HTTP boundary replaced by an injected fake.
//
// What this proves:      the request we send is correct (method, path, body,
//                        auth shape), errors fail closed, and the test/live
//                        base URL switches on the documented env flag.
// What it CANNOT prove:  that Dodo accepts it. Only a real TEST-MODE run can.
//                        See docs/PAYMENT_TEST_RUNBOOK.md for that procedure.
//
// SAFETY PROPERTIES OF THIS FILE:
//   - It overwrites DODO_API_KEY with a fake sentinel before importing the
//     module, so an inherited real key can never be used or printed.
//   - globalThis.fetch is poisoned before every test; any code path that tries
//     to reach the real network fails loudly instead of silently succeeding.
//   - No card number, real or test, appears anywhere in this file.
//
// Run: node --test scripts/payment-lifecycle-test.mjs
// (No npm script is added — package.json is owned by another concern.)

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Env must be set BEFORE the module is imported only for values read at import
// time. dodo.ts reads process.env inside each function, so per-test mutation
// works — but we still pin a fake key up front so nothing real is ever in play.
// ---------------------------------------------------------------------------
const FAKE_KEY = "dodo_test_FAKE_KEY_FOR_TESTS_ONLY_not_a_real_secret";
process.env.DODO_API_KEY = FAKE_KEY;
process.env.DODO_MODE = "test";
process.env.DODO_PAYMENTS_LIVE = "0";
process.env.DODO_PRODUCT_COMPANION = "pdt_fake_companion";
process.env.DODO_PRODUCT_ASSISTANT = "pdt_fake_assistant";
process.env.DODO_PRODUCT_STUDIO = "pdt_fake_studio";
process.env.MIRA_WEB_URL = "https://mira.example.test";

const {
  createDodoCheckout,
  cancelDodoSubscription,
  refundDodoPayment,
  dodoConfigured,
  productIdFor,
  planForProductId,
} = await import("../src/lib/dodo.ts");

const TEST_BASE = "https://test.dodopayments.com";
const LIVE_BASE = "https://live.dodopayments.com";

// ---------------------------------------------------------------------------
// Injected fake HTTP
// ---------------------------------------------------------------------------
let calls = [];
let realFetch;

/** A response double good enough for the three shapes dodo.ts consumes. */
function res(status, payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => (typeof payload === "string" ? JSON.parse(payload) : payload),
  };
}

/** Install a fake fetch that records every call and replies with `responder`. */
function stub(responder) {
  globalThis.fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method,
      headers: init.headers || {},
      rawBody: init.body,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return typeof responder === "function" ? responder(call) : responder;
  };
}

/** The single call the test expects. Fails loudly on 0 or 2+. */
function onlyCall() {
  assert.equal(calls.length, 1, `expected exactly 1 HTTP call, saw ${calls.length}`);
  return calls[0];
}

beforeEach(() => {
  calls = [];
  realFetch = globalThis.fetch;
  // Poison: nothing may touch the real network. A test that forgets to stub
  // must fail, not quietly hit Dodo.
  globalThis.fetch = async () => {
    throw new Error("NETWORK ESCAPE: real fetch was called — this test injected no fake");
  };
  process.env.DODO_API_KEY = FAKE_KEY;
  process.env.DODO_MODE = "test";
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ===========================================================================
// 0. The harness itself is honest
// ===========================================================================

test("harness: the key under test is the fake sentinel, never an inherited real key", () => {
  assert.equal(process.env.DODO_API_KEY, FAKE_KEY);
  assert.match(FAKE_KEY, /FAKE|TEST/i, "the sentinel must be self-evidently not a secret");
});

test("harness: an unstubbed call escapes to nothing — it throws", async () => {
  await assert.rejects(() => globalThis.fetch("https://example.invalid"), /NETWORK ESCAPE/);
});

// ===========================================================================
// 1. BUY — createDodoCheckout: POST /subscriptions
// ===========================================================================

test("buy: POSTs to {base}/subscriptions and returns the hosted payment link", async () => {
  stub(res(200, { payment_link: "https://checkout.example/pay/abc", subscription_id: "sub_123" }));

  const out = await createDodoCheckout({
    plan: "companion",
    email: "buyer@example.test",
    connectToken: "tok_abc123",
  });

  const c = onlyCall();
  assert.equal(c.method, "POST");
  assert.equal(c.url, `${TEST_BASE}/subscriptions`);
  assert.equal(out.url, "https://checkout.example/pay/abc");
  assert.equal(out.subscriptionId, "sub_123");
});

test("buy: body carries product_id, quantity, payment_link and the tier metadata", async () => {
  stub(res(200, { payment_link: "https://checkout.example/pay/abc" }));

  await createDodoCheckout({
    plan: "assistant",
    email: "buyer@example.test",
    connectToken: "tok_xyz",
  });

  const b = onlyCall().body;
  assert.equal(b.product_id, "pdt_fake_assistant", "must use the plan's configured product id");
  assert.equal(b.quantity, 1);
  assert.equal(b.payment_link, true, "we need a hosted link, not a raw intent");
  // The webhook binds the purchase to the Telegram bot using exactly these two.
  assert.equal(b.metadata.connect_token, "tok_xyz");
  assert.equal(b.metadata.plan, "assistant");
});

test("buy: return_url sends the payer back to welcome carrying the connect token", async () => {
  stub(res(200, { payment_link: "https://checkout.example/pay/abc" }));

  await createDodoCheckout({ plan: "studio", email: "b@example.test", connectToken: "tok_ret" });

  assert.equal(
    onlyCall().body.return_url,
    "https://mira.example.test/mira/welcome?token=tok_ret",
  );
});

test("buy: a new customer is sent email + name + create_new_customer (bare {email} is 422)", async () => {
  stub(res(200, { payment_link: "https://checkout.example/pay/abc" }));

  await createDodoCheckout({ plan: "companion", email: "jane.doe@example.test", connectToken: "t" });

  const cust = onlyCall().body.customer;
  assert.equal(cust.email, "jane.doe@example.test");
  assert.equal(cust.name, "jane.doe", "name is derived from the email local-part");
  assert.equal(cust.create_new_customer, true);
});

test("buy: billing.country is always present (MoR tax) and defaults to AE", async () => {
  stub(res(200, { payment_link: "https://checkout.example/pay/abc" }));
  await createDodoCheckout({ plan: "companion", email: "a@example.test", connectToken: "t" });
  assert.equal(onlyCall().body.billing.country, "AE");

  calls = [];
  stub(res(200, { payment_link: "https://checkout.example/pay/abc" }));
  await createDodoCheckout({ plan: "companion", email: "a@example.test", connectToken: "t", country: "GB" });
  assert.equal(onlyCall().body.billing.country, "GB");
});

test("buy: a 2xx with no payment_link is treated as a failure, not a silent success", async () => {
  stub(res(200, { subscription_id: "sub_1" }));
  await assert.rejects(
    () => createDodoCheckout({ plan: "companion", email: "a@example.test", connectToken: "t" }),
    /no payment_link/,
  );
});

test("buy: an unconfigured plan fails BEFORE any HTTP call", async () => {
  const saved = process.env.DODO_PRODUCT_COMPANION;
  delete process.env.DODO_PRODUCT_COMPANION;
  try {
    await assert.rejects(
      () => createDodoCheckout({ plan: "companion", email: "a@example.test", connectToken: "t" }),
      /no Dodo product id configured/,
    );
    assert.equal(calls.length, 0, "must not reach the provider with a missing product id");
  } finally {
    process.env.DODO_PRODUCT_COMPANION = saved;
  }
});

// ===========================================================================
// 2. CANCEL — cancelDodoSubscription: PATCH /subscriptions/{id}
// ===========================================================================

test("cancel: PATCHes {base}/subscriptions/{id}", async () => {
  stub(res(200, {}));
  const out = await cancelDodoSubscription("sub_123");

  const c = onlyCall();
  assert.equal(c.method, "PATCH");
  assert.equal(c.url, `${TEST_BASE}/subscriptions/sub_123`);
  assert.deepEqual(out, { ok: true });
});

test("cancel: the subscription id is URL-encoded into the path (no path injection)", async () => {
  stub(res(200, {}));
  await cancelDodoSubscription("sub_a/b?c=d");
  assert.equal(onlyCall().url, `${TEST_BASE}/subscriptions/sub_a%2Fb%3Fc%3Dd`);
});

test("cancel: defaults to end-of-period — the customer keeps what they paid for", async () => {
  stub(res(200, {}));
  await cancelDodoSubscription("sub_123");

  const b = onlyCall().body;
  assert.equal(b.cancel_at_next_billing_date, true);
  assert.equal(b.cancel_reason, "cancelled_by_customer");
});

test("cancel: atPeriodEnd:false is the ONLY way to cut service immediately", async () => {
  stub(res(200, {}));
  await cancelDodoSubscription("sub_123", { atPeriodEnd: false });
  assert.equal(onlyCall().body.cancel_at_next_billing_date, false);

  // Anything else — including undefined — stays at period end (fail-safe).
  calls = [];
  stub(res(200, {}));
  await cancelDodoSubscription("sub_123", { atPeriodEnd: undefined });
  assert.equal(onlyCall().body.cancel_at_next_billing_date, true);
});

test("cancel: an optional comment is passed through and hard-capped at 3000 chars", async () => {
  stub(res(200, {}));
  await cancelDodoSubscription("sub_123", { comment: "too expensive" });
  assert.equal(onlyCall().body.cancellation_comment, "too expensive");

  calls = [];
  stub(res(200, {}));
  await cancelDodoSubscription("sub_123", { comment: "x".repeat(5000) });
  assert.equal(onlyCall().body.cancellation_comment.length, 3000);
});

test("cancel: no comment means no cancellation_comment field at all", async () => {
  stub(res(200, {}));
  await cancelDodoSubscription("sub_123");
  assert.ok(!("cancellation_comment" in onlyCall().body));
});

test("cancel: an empty subscription id fails BEFORE any HTTP call", async () => {
  await assert.rejects(() => cancelDodoSubscription(""), /subscriptionId required/);
  assert.equal(calls.length, 0);
});

// ===========================================================================
// 3. REFUND — refundDodoPayment: POST /refunds
// ===========================================================================

test("refund: POSTs to {base}/refunds with payment_id, and maps the response", async () => {
  stub(res(200, { refund_id: "ref_789", status: "succeeded" }));
  const out = await refundDodoPayment("pay_456");

  const c = onlyCall();
  assert.equal(c.method, "POST");
  assert.equal(c.url, `${TEST_BASE}/refunds`);
  assert.equal(c.body.payment_id, "pay_456", "payment_id is required by the API");
  assert.equal(out.refundId, "ref_789");
  assert.equal(out.status, "succeeded");
});

test("refund: omitting items means the WHOLE payment is refunded", async () => {
  stub(res(200, { refund_id: "ref_1" }));
  await refundDodoPayment("pay_456");
  const b = onlyCall().body;
  assert.ok(!("items" in b), "no items key = full refund, per the Dodo API");
  assert.deepEqual(Object.keys(b), ["payment_id"], "nothing else is sent by default");
});

test("refund: an optional reason is passed through and hard-capped at 3000 chars", async () => {
  stub(res(200, { refund_id: "ref_1" }));
  await refundDodoPayment("pay_456", { reason: "duplicate charge" });
  assert.equal(onlyCall().body.reason, "duplicate charge");

  calls = [];
  stub(res(200, { refund_id: "ref_1" }));
  await refundDodoPayment("pay_456", { reason: "y".repeat(5000) });
  assert.equal(onlyCall().body.reason.length, 3000);
});

test("refund: an empty payment id fails BEFORE any HTTP call — no blind refund", async () => {
  await assert.rejects(() => refundDodoPayment(""), /paymentId required/);
  assert.equal(calls.length, 0);
});

// ===========================================================================
// 4. AUTH — shape only. A test must NEVER assert a key VALUE.
// ===========================================================================

const authCases = [
  ["buy", () => createDodoCheckout({ plan: "companion", email: "a@example.test", connectToken: "t" }),
    res(200, { payment_link: "https://checkout.example/x" })],
  ["cancel", () => cancelDodoSubscription("sub_123"), res(200, {})],
  ["refund", () => refundDodoPayment("pay_456"), res(200, { refund_id: "r" })],
];

for (const [name, invoke, ok] of authCases) {
  test(`auth: ${name} sends a Bearer Authorization header and JSON content-type`, async () => {
    stub(ok);
    await invoke();

    const h = onlyCall().headers;
    assert.ok(h.Authorization, "Authorization header must be present");
    // SHAPE, never value: "Bearer " + at least one non-space char.
    assert.match(h.Authorization, /^Bearer \S+$/, "must be a Bearer token");
    assert.equal(h["Content-Type"], "application/json");
  });

  test(`auth: ${name} sends the key ONLY in the header, never in the URL or body`, async () => {
    stub(ok);
    await invoke();

    const c = onlyCall();
    assert.ok(!c.url.includes(FAKE_KEY), "the key must never appear in the URL");
    assert.ok(!String(c.rawBody ?? "").includes(FAKE_KEY), "the key must never appear in the body");
  });
}

test("auth: a missing DODO_API_KEY fails closed, before any HTTP call", async () => {
  delete process.env.DODO_API_KEY;
  try {
    await assert.rejects(
      () => createDodoCheckout({ plan: "companion", email: "a@example.test", connectToken: "t" }),
      /DODO_API_KEY unset/,
    );
    await assert.rejects(() => cancelDodoSubscription("sub_1"), /DODO_API_KEY unset/);
    await assert.rejects(() => refundDodoPayment("pay_1"), /DODO_API_KEY unset/);
    assert.equal(calls.length, 0, "no request may be sent without a key");
  } finally {
    process.env.DODO_API_KEY = FAKE_KEY;
  }
});

// ===========================================================================
// 5. FAILURE — non-2xx raises, and the raised error does not carry the key
// ===========================================================================

const failCases = [
  ["buy", () => createDodoCheckout({ plan: "companion", email: "a@example.test", connectToken: "t" }),
    /Dodo create-subscription failed 422/],
  ["cancel", () => cancelDodoSubscription("sub_123"), /Dodo cancel-subscription failed 422/],
  ["refund", () => refundDodoPayment("pay_456"), /Dodo refund failed 422/],
];

for (const [name, invoke, pattern] of failCases) {
  test(`fail: ${name} raises on a non-2xx and names the status`, async () => {
    stub(res(422, { error: "unprocessable", detail: "bad billing country" }));
    await assert.rejects(invoke, pattern);
  });

  test(`fail: ${name}'s thrown error does not leak the API key`, async () => {
    stub(res(500, { error: "internal" }));
    await assert.rejects(invoke, (err) => {
      const dump = `${err.message}\n${err.stack ?? ""}`;
      assert.ok(!dump.includes(FAKE_KEY), `${name} error text must not contain the API key`);
      return true;
    });
  });

  test(`fail: ${name} truncates the provider's error body to 300 chars`, async () => {
    // Bounded blast radius: a provider that returns a megabyte of HTML cannot
    // flood our logs, and an unexpectedly chatty body cannot dump unbounded
    // upstream detail into an error we might surface.
    stub(res(503, "Z".repeat(10_000)));
    await assert.rejects(invoke, (err) => {
      const echoed = (err.message.match(/Z+/) || [""])[0];
      assert.equal(echoed.length, 300, "exactly 300 chars of the provider body are echoed");
      return true;
    });
  });
}

// KNOWN LIMIT, recorded deliberately rather than hidden:
// the thrown Error embeds up to 300 chars of the provider's response body
// verbatim. Our key is never sent in a URL or body (asserted above), so Dodo
// has nothing to echo back — but if a provider ever reflected the credential
// in an error body, it WOULD reach this string. Hardening (redact the key
// substring before interpolation) belongs to whoever owns src/lib/dodo.ts.
test("fail: KNOWN LIMIT — the provider's error body is echoed verbatim (documented, not fixed here)", async () => {
  stub(res(400, "upstream said: dodo_test_FAKE_KEY_FOR_TESTS_ONLY_not_a_real_secret"));
  await assert.rejects(
    () => refundDodoPayment("pay_1"),
    (err) => {
      // This asserts CURRENT behaviour so a future fix flips this test loudly.
      assert.ok(
        err.message.includes(FAKE_KEY),
        "if this now fails, redaction was added — update this test and delete the KNOWN LIMIT note",
      );
      return true;
    },
  );
});

// ===========================================================================
// 6. TEST vs LIVE — the base URL must switch on DODO_MODE, and fail safe
// ===========================================================================

async function baseUrlFor(modeValue) {
  if (modeValue === undefined) delete process.env.DODO_MODE;
  else process.env.DODO_MODE = modeValue;
  calls = [];
  stub(res(200, {}));
  await cancelDodoSubscription("sub_probe");
  return new URL(onlyCall().url).origin;
}

test("mode: DODO_MODE=live is the ONLY value that reaches the live host", async () => {
  assert.equal(await baseUrlFor("live"), LIVE_BASE);
});

test("mode: test, unset, and near-misses all fall back to the TEST host (fail safe)", async () => {
  for (const v of ["test", undefined, "", "LIVE", "Live", "live ", "production", "1", "true"]) {
    assert.equal(
      await baseUrlFor(v),
      TEST_BASE,
      `DODO_MODE=${JSON.stringify(v)} must NOT reach live — the check is an exact, case-sensitive "live"`,
    );
  }
});

test("mode: all three lifecycle calls honour the same switch — none is hard-coded", async () => {
  process.env.DODO_MODE = "live";

  calls = [];
  stub(res(200, { payment_link: "https://checkout.example/x" }));
  await createDodoCheckout({ plan: "companion", email: "a@example.test", connectToken: "t" });
  assert.equal(onlyCall().url, `${LIVE_BASE}/subscriptions`);

  calls = [];
  stub(res(200, {}));
  await cancelDodoSubscription("sub_1");
  assert.equal(onlyCall().url, `${LIVE_BASE}/subscriptions/sub_1`);

  calls = [];
  stub(res(200, { refund_id: "r" }));
  await refundDodoPayment("pay_1");
  assert.equal(onlyCall().url, `${LIVE_BASE}/refunds`);
});

// ===========================================================================
// 7. THE GOTCHA — the money GATE and the base-URL SWITCH are different vars
// ===========================================================================

test("gate: dodoConfigured needs BOTH a key and DODO_PAYMENTS_LIVE=1", () => {
  const saved = process.env.DODO_PAYMENTS_LIVE;
  try {
    for (const v of ["0", "", "true", "yes", "LIVE"]) {
      process.env.DODO_PAYMENTS_LIVE = v;
      assert.equal(dodoConfigured("companion"), false, `DODO_PAYMENTS_LIVE=${v} must not open the path`);
    }
    delete process.env.DODO_PAYMENTS_LIVE;
    assert.equal(dodoConfigured("companion"), false, "unset must not open the path");

    process.env.DODO_PAYMENTS_LIVE = "1";
    assert.equal(dodoConfigured("companion"), true);

    delete process.env.DODO_API_KEY;
    assert.equal(dodoConfigured("companion"), false, "no key = closed, whatever the flag says");
    process.env.DODO_API_KEY = FAKE_KEY;

    const savedProd = process.env.DODO_PRODUCT_STUDIO;
    delete process.env.DODO_PRODUCT_STUDIO;
    assert.equal(dodoConfigured("studio"), false, "a plan with no product id is not configured");
    assert.equal(dodoConfigured(), true, "the keyless overload only checks key + flag");
    process.env.DODO_PRODUCT_STUDIO = savedProd;
  } finally {
    if (saved === undefined) delete process.env.DODO_PAYMENTS_LIVE;
    else process.env.DODO_PAYMENTS_LIVE = saved;
  }
});

test("gate: GOTCHA — DODO_PAYMENTS_LIVE=1 alone still sends traffic to the TEST host", async () => {
  // These two flags are independent. Opening the money path (DODO_PAYMENTS_LIVE)
  // does NOT move you to the live host (DODO_MODE). A real launch needs BOTH;
  // a test-mode lifecycle run needs DODO_PAYMENTS_LIVE=1 and DODO_MODE=test.
  const saved = process.env.DODO_PAYMENTS_LIVE;
  process.env.DODO_PAYMENTS_LIVE = "1";
  process.env.DODO_MODE = "test";
  try {
    assert.equal(dodoConfigured("companion"), true, "the money path is open...");
    calls = [];
    stub(res(200, {}));
    await cancelDodoSubscription("sub_probe");
    assert.equal(new URL(onlyCall().url).origin, TEST_BASE, "...but the traffic is still test-mode");
  } finally {
    if (saved === undefined) delete process.env.DODO_PAYMENTS_LIVE;
    else process.env.DODO_PAYMENTS_LIVE = saved;
  }
});

// ===========================================================================
// 8. TIER MAPPING — the webhook must resolve a product id back to a plan
// ===========================================================================

test("tier: each plan maps to its configured product id and back again", () => {
  for (const [plan, id] of [
    ["companion", "pdt_fake_companion"],
    ["assistant", "pdt_fake_assistant"],
    ["studio", "pdt_fake_studio"],
  ]) {
    assert.equal(productIdFor(plan), id);
    assert.equal(planForProductId(id), plan, "the webhook must recover the tier from the product id");
  }
});

test("tier: an unknown or empty product id yields null — never a guessed plan", () => {
  for (const v of ["pdt_not_ours", "", null, undefined]) {
    assert.equal(planForProductId(v), null, `${JSON.stringify(v)} must not resolve to a paid tier`);
  }
});
