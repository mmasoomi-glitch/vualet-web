// Fail-safe coming-soon gate: payments must be OFF unless PAYMENTS_LIVE=1 is set,
// even when a live STRIPE_SECRET_KEY is present. Guards mira.vualet.com from taking
// money on counsel-unreviewed legal pages (req #39/#40).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "src", "lib", "stripe.ts"), "utf8");

// Pure re-implementation of the guard's truth table (kept in lockstep with stripe.ts).
const gate = (hasKey, live) => Boolean(hasKey) && live === "1";

test("gate is OFF with no key (any flag)", () => {
  assert.equal(gate("", undefined), false);
  assert.equal(gate("", "1"), false);
});

test("gate is OFF when a live key is present but PAYMENTS_LIVE is unset — the coming-soon default", () => {
  assert.equal(gate("sk_live_xxx", undefined), false);
  assert.equal(gate("sk_live_xxx", ""), false);
  assert.equal(gate("sk_live_xxx", "0"), false);
  assert.equal(gate("sk_live_xxx", "true"), false); // only the exact "1" opens it
});

test("gate is ON only when a key is present AND PAYMENTS_LIVE=1", () => {
  assert.equal(gate("sk_live_xxx", "1"), true);
});

test("source guard: paymentsConfigured requires the PAYMENTS_LIVE clause (no regression to key-only)", () => {
  const body = src.slice(src.indexOf("export function paymentsConfigured"));
  assert.match(body, /STRIPE_SECRET_KEY/);
  assert.match(body, /PAYMENTS_LIVE\s*===\s*"1"/, "gate must require PAYMENTS_LIVE === \"1\"");
});
