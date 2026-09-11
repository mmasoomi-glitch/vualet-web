/**
 * Standalone tests for the free-trial gate logic.
 *
 * These tests exercise the same logic as `shouldAskForEmail` in
 * `src/app/api/veridian-demo/route.ts` without importing the route module,
 * so they work with zero dependencies — no `node_modules` or `next/server.js`
 * required.
 */
import { test } from "node:test";
import { equal } from "node:assert";

// ── The gate logic (mirrors src/app/api/veridian-demo/route.ts) ──────────────

function shouldAskForEmail(
  turnNumber,
  hasEmail,
  everyN,
  threshold,
) {
  if (hasEmail) return false;
  if (threshold <= 0) return false;
  if (turnNumber <= threshold) return false;
  return (turnNumber - threshold - 1) % everyN === 0;
}

// ── Cases ──────────────────────────────────────────────────────────────────

test("never asks when hasEmail=true, any turn", () => {
  equal(shouldAskForEmail(1, true, 10, 20), false);
  equal(shouldAskForEmail(20, true, 10, 20), false);
  equal(shouldAskForEmail(21, true, 10, 20), false);
  equal(shouldAskForEmail(31, true, 10, 20), false);
  equal(shouldAskForEmail(100, true, 10, 20), false);
});

test("never asks at or below threshold", () => {
  equal(shouldAskForEmail(20, false, 10, 20), false);
  equal(shouldAskForEmail(1, false, 10, 20), false);
  equal(shouldAskForEmail(10, false, 10, 20), false);
});

test("asks on first turn past threshold", () => {
  equal(shouldAskForEmail(21, false, 10, 20), true);
});

test("does NOT ask on turns between threshold+1 and next interval", () => {
  equal(shouldAskForEmail(22, false, 10, 20), false);
  equal(shouldAskForEmail(23, false, 10, 20), false);
  equal(shouldAskForEmail(25, false, 10, 20), false);
  equal(shouldAskForEmail(30, false, 10, 20), false);
});

test("asks again on turn 31 (threshold + 10)", () => {
  equal(shouldAskForEmail(31, false, 10, 20), true);
});

test("periodic pattern continues beyond 40", () => {
  equal(shouldAskForEmail(41, false, 10, 20), true);
  equal(shouldAskForEmail(42, false, 10, 20), false);
});

test("never asks when threshold=0 (OFF SWITCH)", () => {
  equal(shouldAskForEmail(1, false, 10, 0), false);
  equal(shouldAskForEmail(21, false, 10, 0), false);
  equal(shouldAskForEmail(100, false, 10, 0), false);
});

test("never asks when threshold is negative (OFF SWITCH)", () => {
  equal(shouldAskForEmail(1, false, 10, -1), false);
  equal(shouldAskForEmail(50, false, 10, -5), false);
});
