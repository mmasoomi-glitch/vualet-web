// The admin console's authorisation surface.
//
// Nine of the thirteen untested routes in this repo are admin routes: creating
// admins, assigning roles, removing admins, enrolling MFA, revoking sessions,
// reading the audit trail. That is the privilege-escalation surface of the
// whole product, and none of it had a test.
//
// These routes only became testable this session: the harness strips types
// rather than compiling them, and AdminAuthError used TypeScript constructor
// parameter properties, so ANY route importing the admin guard failed to load.
// That is why this gap existed.
//
// The question here is not what these routes do when called correctly. It is
// whether they can be called at all by somebody who should not be able to.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRoute, readJson, resetNet } from "./route-harness/index.mjs";
import { __cookies } from "./route-harness/stubs/next-headers.mjs";

/** Every admin route, the methods it exposes, and the permission it must demand. */
const ADMIN_ROUTES = [
  { path: "src/app/api/admin/admins/route.ts", methods: ["GET", "POST"], permission: "admin.read / admin.invite" },
  { path: "src/app/api/admin/admins/[id]/route.ts", methods: ["PATCH", "DELETE"], permission: "admin.role.assign / admin.remove" },
  { path: "src/app/api/admin/audit/route.ts", methods: ["GET"], permission: "audit.read" },
  { path: "src/app/api/admin/customers/route.ts", methods: ["GET"], permission: "customers.read" },
  { path: "src/app/api/admin/sessions/route.ts", methods: ["GET", "DELETE"], permission: "sessions.read.any / sessions.revoke.any" },
  { path: "src/app/api/admin/me/route.ts", methods: ["GET"], permission: "a valid admin session" },
  { path: "src/app/api/admin/reauth/route.ts", methods: ["POST"], permission: "a valid admin session" },
  { path: "src/app/api/admin/mfa/enroll/route.ts", methods: ["POST"], permission: "a valid admin session" },
  { path: "src/app/api/admin/mfa/verify/route.ts", methods: ["POST"], permission: "a valid admin session" },
];

/**
 * Endpoints under /api/admin that are UNAUTHENTICATED ON PURPOSE.
 *
 * Listed explicitly, each with the reason, so that "this one does not require a
 * session" is a recorded decision rather than something a reader has to infer
 * from its absence. Anything added to /api/admin that is not in the guarded
 * list above must be justified here or it is a hole.
 */
const DELIBERATELY_PUBLIC = [
  {
    path: "src/app/api/admin/mfa/verify/route.ts",
    method: "DELETE",
    why: "clears the caller's OWN cookies — an abort/logout. Clearing cookies you do not have is a no-op, so there is nothing here to protect.",
  },
  {
    path: "src/app/api/admin/login/route.ts",
    method: "POST",
    why: "logging in is how a session is obtained; requiring one to get one would be a closed loop. It is gated by credentials and rate limiting instead.",
  },
  {
    path: "src/app/api/admin/invite/accept/route.ts",
    method: "POST",
    why: "the whole point is that the caller has no admin session yet. It is gated by a single-use invite token instead.",
  },
];

const req = (method, url = "https://mira.vualet.com/api/admin/test") =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(method === "GET" || method === "DELETE" ? {} : { body: JSON.stringify({}) }),
  });

/** Next passes route params as a second argument; these routes may read it. */
const ctx = { params: Promise.resolve({ id: "adm_someone_else" }) };

test("NO ADMIN ROUTE SERVES AN ANONYMOUS CALLER", async () => {
  resetNet();
  __cookies.clear();

  for (const route of ADMIN_ROUTES) {
    const mod = await loadRoute(route.path);
    for (const method of route.methods) {
      const handler = mod[method];
      assert.ok(handler, `${route.path} should export ${method}`);

      const { status, body } = await readJson(await handler(req(method), ctx));
      assert.ok(
        status === 401 || status === 403,
        `${method} ${route.path} answered ${status} to a caller with no session. It requires ${route.permission}.`,
      );
      assert.ok(
        !body || typeof body !== "object" || !("rows" in body || "admins" in body || "sessions" in body),
        `${method} ${route.path} returned data in a refusal body`,
      );
    }
  }
});

test("A REFUSAL LEAKS NOTHING ABOUT THE CONSOLE", async () => {
  resetNet();
  __cookies.clear();

  const forbidden = ["adm_", "owner", "security", "auditor", "totp", "secret", "hash", "@"];
  for (const route of ADMIN_ROUTES) {
    const mod = await loadRoute(route.path);
    for (const method of route.methods) {
      const { body } = await readJson(await mod[method](req(method), ctx));
      const serialised = JSON.stringify(body ?? {}).toLowerCase();
      for (const leak of forbidden) {
        assert.ok(
          !serialised.includes(leak),
          `${method} ${route.path} leaked "${leak}" while refusing — a refusal must not tell a stranger who the admins are or how they authenticate`,
        );
      }
    }
  }
});

test("A FORGED SESSION COOKIE IS NOT A SESSION", async () => {
  resetNet();

  // A well-formed-looking value that was never signed by us.
  for (const forged of [
    "not-a-real-token",
    "eyJhbGciOiJub25lIn0.eyJhZG1pbklkIjoiYWRtXzEifQ.",
    "admin",
    "",
  ]) {
    __cookies.clear();
    __cookies.set("mira_admin_session", forged);

    for (const route of ADMIN_ROUTES) {
      const mod = await loadRoute(route.path);
      for (const method of route.methods) {
        const { status } = await readJson(await mod[method](req(method), ctx));
        assert.ok(
          status === 401 || status === 403,
          `${method} ${route.path} accepted a forged cookie (${forged.slice(0, 16)}) with ${status}. The signature is the only thing standing between a stranger and the admin console.`,
        );
      }
    }
  }
  __cookies.clear();
});

test("THE CUSTOMER SESSION COOKIE DOES NOT OPEN THE ADMIN CONSOLE", async () => {
  resetNet();
  process.env.MIRA_SESSION_SECRET = process.env.MIRA_SESSION_SECRET || "test-session-secret-abcdefghijklmn";

  // A genuine, correctly signed CUSTOMER session. Different cookie, different
  // secret, different audience — but a customer holding one is exactly who
  // would try it.
  const { createSessionToken, SESSION_COOKIE } = await import("../src/lib/session.ts");
  __cookies.clear();
  __cookies.set(SESSION_COOKIE, createSessionToken("customer@example.com"));
  __cookies.set("mira_admin_session", createSessionToken("customer@example.com"));

  for (const route of ADMIN_ROUTES) {
    const mod = await loadRoute(route.path);
    for (const method of route.methods) {
      const { status } = await readJson(await mod[method](req(method), ctx));
      assert.ok(
        status === 401 || status === 403,
        `${method} ${route.path} accepted a customer session with ${status} — a paying customer must never be able to reach the staff console`,
      );
    }
  }
  __cookies.clear();
});

test("EVERY ADMIN ROUTE REFUSES BEFORE IT READS A BODY", async () => {
  resetNet();
  __cookies.clear();

  // A body that would break a handler that parsed it before checking auth.
  const hostile = new Request("https://mira.vualet.com/api/admin/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ this is not json",
  });

  for (const route of ADMIN_ROUTES) {
    if (!route.methods.includes("POST")) continue;
    const mod = await loadRoute(route.path);
    const { status } = await readJson(await mod.POST(hostile.clone(), ctx));
    assert.ok(
      status === 401 || status === 403,
      `POST ${route.path} answered ${status} to malformed input from an anonymous caller. Auth must be decided before the body is trusted, or a parser bug becomes a pre-auth attack surface.`,
    );
  }
});


test("THE UNAUTHENTICATED ENDPOINTS ARE THE ONES WE MEANT", async () => {
  resetNet();
  __cookies.clear();

  for (const { path, method, why } of DELIBERATELY_PUBLIC) {
    const mod = await loadRoute(path);
    const { status } = await readJson(await mod[method](req(method), ctx));
    // The point is only that it does not DEMAND a session. A 503 here means
    // the admin auth is unconfigured in this environment, which is a correct
    // fail-closed answer and not the closed loop this test is about.
    assert.ok(
      status !== 401 && status !== 403,
      `${method} ${path} demanded a session with ${status}, but ${why}`,
    );
  }
});

test("NO ADMIN ROUTE IS UNGUARDED BY ACCIDENT", async () => {
  // Every route file under /api/admin must appear in exactly one of the two
  // lists. A new one that appears in neither is a hole nobody decided on.
  const { readdirSync, statSync } = await import("fs");
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts") found.push(full.split("\\").join("/"));
    }
  };
  walk("src/app/api/admin");

  const accounted = new Set([...ADMIN_ROUTES.map((r) => r.path), ...DELIBERATELY_PUBLIC.map((r) => r.path)]);
  for (const path of found) {
    assert.ok(
      accounted.has(path),
      `${path} exists under /api/admin but is in neither the guarded list nor the deliberately-public list. Add it to one: an admin route nobody classified is an admin route nobody checked.`,
    );
  }
  assert.ok(found.length >= 10, `expected to find the admin routes, found ${found.length}`);
});
