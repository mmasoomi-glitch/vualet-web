// The reliability ops API.
//
// These endpoints expose internal state names, provider routing, probe URLs
// and error strings. That is exactly what an operator needs and exactly what
// nobody else may have, so the guard is the thing under test here.
//
// The harness blocks every outbound call, so no probe here reaches a network.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, readJson, resetNet } from "./route-harness/index.mjs";

const OPS_ROUTES = [
  "src/app/api/ops/health/route.ts",
  "src/app/api/ops/services/route.ts",
  "src/app/api/ops/incidents/route.ts",
  "src/app/api/ops/assistant/status/route.ts",
];

const getReq = (url = "https://mira.vualet.com/api/ops/test") => new Request(url);

test("EVERY OPS ENDPOINT REFUSES AN UNAUTHENTICATED READ", async () => {
  resetNet();
  for (const routePath of OPS_ROUTES) {
    const { GET } = await loadRoute(routePath);
    const { status, body } = await readJson(await GET(getReq()));
    assert.ok(
      status === 401 || status === 403,
      `${routePath} answered ${status} to an anonymous caller; internal state must never be readable without health.read`,
    );
    const serialised = JSON.stringify(body);
    for (const leak of ["FAILOVER_ACTIVE", "OFFLINE", "incidentId", "tracker", "127.0.0.1"]) {
      assert.ok(
        !serialised.includes(leak),
        `${routePath} leaked "${leak}" in its refusal body`,
      );
    }
  }
});

test("the forced-recheck endpoint refuses an unauthenticated write", async () => {
  resetNet();
  const { POST } = await loadRoute("src/app/api/ops/services/route.ts");
  const req = new Request("https://mira.vualet.com/api/ops/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service: "assistant" }),
  });
  const { status } = await readJson(await POST(req));
  assert.ok(
    status === 401 || status === 403,
    `forcing a probe is an action, not a read, and answered ${status} to an anonymous caller`,
  );
});

test("AN ANONYMOUS REFUSAL STARTS NO POLLING", async () => {
  resetNet();
  // requireAdmin runs before the runtime is touched, so a refused request must
  // not have begun a background poll loop. If it had, this process would be
  // left with live timers and the monitor would be startable by a stranger.
  const { GET } = await loadRoute("src/app/api/ops/health/route.ts");
  await GET(getReq());

  const { reliabilityIdle } = await import("../src/lib/reliability-runtime.ts");
  assert.equal(
    reliabilityIdle().isRunning(),
    false,
    "an unauthenticated request must never be what starts the monitoring subsystem",
  );
});

/* ── the public endpoint ───────────────────────────────────────────────── */

test("THE PUBLIC STATUS ENDPOINT RETURNS EXACTLY TWO FIELDS", async () => {
  resetNet();
  const { GET } = await loadRoute("src/app/api/assistant/status/route.ts");
  const { status, body } = await readJson(await GET(getReq()));

  assert.equal(status, 200, "it is public and always answers");
  assert.deepEqual(
    Object.keys(body).sort(),
    ["degraded", "notice"],
    "this endpoint is unauthenticated; every extra field is one property access away from leaking a state name, a provider or an error string",
  );
  assert.equal(typeof body.degraded, "boolean", "degraded is a plain boolean");
  assert.ok(body.notice === null || typeof body.notice === "string", "notice is a string or null");
});

test("the public endpoint leaks nothing even when it has a notice to give", async () => {
  resetNet();
  const { GET } = await loadRoute("src/app/api/assistant/status/route.ts");
  const { body } = await readJson(await GET(getReq()));

  const serialised = JSON.stringify(body).toLowerCase();
  for (const leak of [
    "failover", "offline", "degraded_state", "vllm", "openrouter", "127.0.0.1",
    "incident", "tracker", "latency", "error", "http", "apikey", "token",
  ]) {
    assert.ok(
      !serialised.includes(leak),
      `the public payload contains "${leak}" — a visitor must never read an internal detail`,
    );
  }
});

test("the public endpoint never returns an error to a visitor", async () => {
  resetNet();
  const { GET } = await loadRoute("src/app/api/assistant/status/route.ts");
  const { status, body } = await readJson(await GET(getReq()));
  assert.equal(status, 200, "even a broken reliability subsystem must not become a visible failure");

  // Env-independent contract: a degraded answer always comes with something to
  // say, and a healthy one never apologises for nothing.
  if (body.degraded) {
    assert.ok(
      typeof body.notice === "string" && body.notice.length > 0,
      "telling a visitor they are degraded without telling them anything useful is worse than saying nothing",
    );
  } else {
    assert.equal(body.notice, null, "a working assistant must not apologise");
  }
});
