// Defect E (jury #102): a paying customer must be able to CANCEL self-serve,
// while REFUNDS stay behind human approval.
//
// The security properties matter more than the happy path here, because the
// route this replaces had a real IDOR. These tests assert, by source-scan
// against the production files, that:
//   - identity comes ONLY from the verified session, never from client input
//   - the refund route never calls the payment provider
//   - our stored state is only marked cancelled AFTER the provider confirms
//
// Run: npm run test:cancel
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(root, ...p), "utf8");

const cancelSrc = read("src", "app", "api", "subscription", "cancel", "route.ts");
const refundSrc = read("src", "app", "api", "subscription", "refund-request", "route.ts");
const dodoSrc = read("src", "lib", "dodo.ts");
const storeSrc = read("src", "lib", "store.ts");

// ---- anti-IDOR: identity must come from the session, never from the client ----

test("cancel resolves the subscription from the SESSION email only", () => {
  assert.match(cancelSrc, /getSession\(\)/, "must read the verified session");
  assert.match(
    cancelSrc,
    /getSubscriptionByEmail\(\s*session\.email\s*\)/,
    "must look up by the session email",
  );
});

test("cancel accepts NO client-supplied identifier — nothing to tamper with", () => {
  // The handler takes no request argument at all, so there is no body to trust.
  assert.match(
    cancelSrc,
    /export async function POST\(\)/,
    "POST must take no request parameter",
  );
  assert.doesNotMatch(
    cancelSrc,
    /body\.(customerId|customer_id|subscriptionId|subscription_id|email)/,
    "must never read an identity field from the request body",
  );
});

test("cancel refuses an unauthenticated caller", () => {
  assert.match(cancelSrc, /not_signed_in/);
  assert.match(cancelSrc, /status:\s*401/);
});

test("getSubscriptionByEmail re-checks the record's own email (defence in depth)", () => {
  assert.match(
    storeSrc,
    /rec\.email[^\n]*toLowerCase\(\)\s*!==\s*email[^\n]*toLowerCase\(\)/,
    "the stored record's email must be re-verified against the session email",
  );
  assert.match(storeSrc, /return null/, "a mismatch must yield null, not a record");
});

// ---- refunds must NOT move money without a human ----

// Strip comments so a doc comment that *mentions* a function is never mistaken
// for a call to it. We care about executable code, not prose.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the refund-request route NEVER calls the payment provider", () => {
  const code = stripComments(refundSrc);
  assert.doesNotMatch(
    code,
    /refundDodoPayment\s*\(/,
    "the customer-facing refund route must not call the Dodo refund API",
  );
  assert.doesNotMatch(
    code,
    /fetch\([^)]*dodo/i,
    "it must not reach the payment provider by any other route",
  );
  assert.match(refundSrc, /getSession\(\)/, "it must still be authenticated");
});

test("refundDodoPayment exists for an operator path but is not imported by the customer route", () => {
  assert.match(dodoSrc, /export async function refundDodoPayment/);
  assert.doesNotMatch(refundSrc, /from "@\/lib\/dodo"/, "customer route must not import the dodo client");
});

test("a refund request is recorded durably before any best-effort email", () => {
  const recordAt = refundSrc.indexOf("await record(");
  const mailAt = refundSrc.indexOf("sendMail(");
  assert.ok(recordAt > -1 && mailAt > -1, "both must exist");
  assert.ok(recordAt < mailAt, "durable record must be written before notification");
  assert.match(refundSrc, /not_recorded/, "a failed record must be reported honestly");
});

// ---- cancellation semantics ----

test("cancel is at period end — the customer keeps what they paid for", () => {
  assert.match(dodoSrc, /cancel_at_next_billing_date/);
  assert.match(dodoSrc, /cancelled_by_customer/, "self-serve cancels use the customer reason");
  assert.match(cancelSrc, /atPeriodEnd:\s*true/);
});

test("our state is marked cancelled only AFTER the provider confirms", () => {
  const providerAt = cancelSrc.indexOf("await cancelDodoSubscription(");
  const writeAt = cancelSrc.indexOf('rec.status = "cancelled"');
  assert.ok(providerAt > -1 && writeAt > -1, "both steps must exist");
  assert.ok(
    providerAt < writeAt,
    "we must not claim cancelled while billing could still be running",
  );
});

test("a provider failure fails closed and points the customer at a human", () => {
  assert.match(cancelSrc, /cancel_failed/);
  assert.match(cancelSrc, /status:\s*502/);
});

test("cancelling twice is idempotent, not an error", () => {
  assert.match(cancelSrc, /alreadyCancelled/);
});

test("a customer with no resolvable subscription is sent to a human, never guessed at", () => {
  assert.match(cancelSrc, /no_subscription/);
  assert.match(cancelSrc, /status:\s*404/);
  assert.match(cancelSrc, /manual_required/, "missing subscriptionId must not call the provider");
});

// ---- the index that makes email->subscription possible at all ----

test("putSubscription maintains the email index that cancellation depends on", () => {
  assert.match(storeSrc, /subIdByEmail/);
  assert.match(
    storeSrc,
    /export async function putSubscription[\s\S]*?kvSet\(subIdByEmail/,
    "the index must be written by the same call that persists the subscription",
  );
});

test("the email index key is normalised so session and stored emails always agree", () => {
  assert.match(storeSrc, /subIdByEmail = \(email: string\) =>[\s\S]*?toLowerCase\(\)/);
});
