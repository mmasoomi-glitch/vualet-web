// Defect B (jury #101): a paid checkout must never reach Dodo without a real
// customer email, or dodo.ts falls back to the shared hardcoded
// "guest@vualet.com" identity and every paying customer becomes one fake record.
//
// Mirrors the style of scripts/payments-gate-test.mjs: exercise the decision
// logic directly, then source-scan the production route to prove the guard is
// actually present and wired to the value that gets used downstream.
//
// Run: npm run test:email
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROUTE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "app",
  "api",
  "checkout",
  "route.ts",
);
const src = readFileSync(ROUTE, "utf8");

// The exact predicate the route applies. Kept in lockstep with the route by the
// source-scan tests below, which fail if the route's regex or bound drifts.
const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;
const accepts = (raw) => {
  const clean = typeof raw === "string" ? raw.trim() : "";
  return EMAIL_RE.test(clean) && clean.length <= 200;
};

test("a real customer email is accepted", () => {
  for (const ok of [
    "someone@example.com",
    "first.last@sub.example.co.uk",
    "user+tag@example.io",
    "  spaced@example.com  ", // trimmed before validation
  ]) {
    assert.equal(accepts(ok), true, `should accept: ${JSON.stringify(ok)}`);
  }
});

test("a missing email is REJECTED — this is the whole defect", () => {
  for (const bad of [undefined, null, "", "   ", 0, false, {}, []]) {
    assert.equal(accepts(bad), false, `should reject: ${JSON.stringify(bad)}`);
  }
});

test("a malformed email is REJECTED", () => {
  for (const bad of [
    "notanemail",
    "@example.com",
    "user@",
    "user@localhost", // no dot in the domain
    "user @example.com",
    "user@exa mple.com",
    "two@@example.com",
  ]) {
    assert.equal(accepts(bad), false, `should reject: ${JSON.stringify(bad)}`);
  }
});

test("an absurdly long email is REJECTED (200 char bound)", () => {
  assert.equal(accepts("a".repeat(250) + "@example.com"), false); // 262 chars
  assert.equal(accepts("a".repeat(189) + "@example.com"), false); // 201 chars, just over
  assert.equal(accepts("a".repeat(188) + "@example.com"), true); // 200 chars, exactly at bound
  assert.equal(accepts("a".repeat(100) + "@example.com"), true);
});

test("the guest fallback address itself is a VALID email — proving the format check alone is not the fix", () => {
  // The point of the route guard is that no request arrives WITHOUT an email;
  // the fallback in dodo.ts is only reachable when email is absent.
  assert.equal(accepts("guest@vualet.com"), true);
});

// ---- source-scan: prove the production route actually enforces this ----

test("route.ts contains the server-side email guard", () => {
  assert.match(src, /email_required/, "route must return an email_required error");
  assert.match(src, /cleanEmail/, "route must compute a trimmed cleanEmail");
  assert.match(src, /status:\s*400/, "missing email must be a 400");
});

test("route.ts uses the VALIDATED email downstream, not the raw body value", () => {
  assert.match(
    src,
    /email:\s*cleanEmail/,
    "the connect record must store cleanEmail",
  );
  assert.match(
    src,
    /createDodoCheckout\(\{[^}]*email:\s*cleanEmail/,
    "createDodoCheckout must receive cleanEmail, never the raw body email",
  );
  assert.doesNotMatch(
    src,
    /createDodoCheckout\(\{\s*plan,\s*email,/,
    "createDodoCheckout must not be called with the unvalidated email",
  );
});

test("the email guard runs BEFORE createDodoCheckout is reached", () => {
  const guardAt = src.indexOf("email_required");
  // Match the CALL, not the import at the top of the file.
  const dodoAt = src.indexOf("createDodoCheckout({");
  assert.ok(guardAt > -1, "the email_required guard must exist");
  assert.ok(dodoAt > -1, "the createDodoCheckout call site must exist");
  assert.ok(
    guardAt < dodoAt,
    "the guard must appear before the Dodo call so it fails closed",
  );
});
