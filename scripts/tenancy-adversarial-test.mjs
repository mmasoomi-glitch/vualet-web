// ADVERSARIAL multi-tenancy suite (dossier loophole #9). Isolation here was
// well-built and unit-tested but never ATTACKED. Every test below is an attack
// that must be repelled; there are deliberately no happy-path assertions.
//
// The harness block (sign/postEvent) is the proven one from the sibling
// scripts/dodo-webhook-test.mjs - Standard Webhooks headers, base64 HMAC over
// id.timestamp.rawBody, and a body of { type, data }.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { secretKeyBytes } from "../src/lib/dodo-webhook-core.mjs";
import { readFileSync } from "node:fs";
import { loadRoute, env, resetNet, readJson } from "./route-harness/index.mjs";

const store = await loadRoute("src/lib/store.ts");
const dodoRoute = await loadRoute("src/app/api/webhooks/dodo/route.ts");
// The admin routes are NOT module-loaded anywhere in this repo, and cannot be:
// src/lib/admin-guard.ts uses TypeScript parameter properties, which Node's
// strip-only loader rejects (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX). The admin
// suites assert against route SOURCE instead, and so does the attack below.

const SECRET = "whsec_" + Buffer.from("mira-dodo-test-secret-key").toString("base64");

function sign(id, ts, body) {
  const key = secretKeyBytes(Buffer, SECRET);
  const sig = crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return `v1,${sig}`;
}

/** POST a correctly signed Dodo event at the real route. */
async function postEvent(id, type, data) {
  const body = JSON.stringify({ type, data });
  const ts = String(Math.floor(Date.now() / 1000));
  const req = new Request("https://mira.vualet.com/api/webhooks/dodo", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": ts,
      "webhook-signature": sign(id, ts, body),
    },
    body,
  });
  return readJson(await dodoRoute.POST(req));
}

function freshEnv() {
  env({
    DODO_API_KEY: "dodo_test_key",
    DODO_MODE: "test",
    DODO_PRODUCT_COMPANION: "prod_c",
    DODO_PRODUCT_ASSISTANT: "prod_a",
    DODO_PRODUCT_STUDIO: "prod_s",
  });
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  resetNet();
}

// a foreign product cannot mint a tier on a colliding email
test("ATTACK: a foreign product cannot mint a tier on a colliding email", async () => {
  freshEnv();
  await store.putSubscription("cus_tenantA", {
    token: "tok_a",
    plan: "companion",
    email: "shared@example.com",
    status: "active",
    createdAt: new Date().toISOString(),
  });
  const preAttack = await store.getSubscription("cus_tenantA");
  const res = await postEvent("evt_attack1", "subscription.active", {
    customer: { customer_id: "cus_attacker", email: "shared@example.com" },
    subscription_id: "sub_attack1",
    product_id: "prod_filehub_pro",
  });
  assert.strictEqual(res.status, 200);
  assert.ok(!(await store.getSubscription("cus_attacker")), "a foreign product must never mint a record");
  assert.deepEqual(await store.getSubscription("cus_tenantA"), preAttack, "the neighbour record must be untouched");
});

// one tenant's event cannot rewrite another tenant's record
test("ATTACK: one tenant's event cannot rewrite another tenant's record", async () => {
  freshEnv();
  await store.putSubscription("cus_tenantA", {
    token: "tok_a",
    plan: "companion",
    email: "a@example.com",
    status: "active",
    createdAt: new Date().toISOString(),
  });
  await store.putSubscription("cus_tenantB", {
    token: "tok_b",
    plan: "studio",
    email: "b@example.com",
    status: "active",
    createdAt: new Date().toISOString(),
  });
  const preB = await store.getSubscription("cus_tenantB");
  await postEvent("evt_attack2", "subscription.active", {
    customer: { customer_id: "cus_tenantA", email: "a@example.com" },
    subscription_id: "sub_attack2",
    product_id: "prod_s",
  });
  assert.deepEqual(await store.getSubscription("cus_tenantB"), preB, "a write for one customer id must never touch another");
});

// email lookup never returns a record belonging to a different customer
test("ATTACK: email lookup never returns a record belonging to a different customer", async () => {
  freshEnv();
  await store.putSubscription("cus_tenantA", {
    token: "tok_a",
    plan: "companion",
    email: "a@example.com",
    status: "active",
    createdAt: new Date().toISOString(),
  });
  await store.putSubscription("cus_tenantB", {
    token: "tok_b",
    plan: "studio",
    email: "b@example.com",
    status: "active",
    createdAt: new Date().toISOString(),
  });
  const result = await store.getSubscriptionByEmail("b@example.com");
  assert.strictEqual(result.customerId, "cus_tenantB");
  assert.strictEqual(result.rec.email, "b@example.com");
});

// an unknown email yields nothing, never the nearest record
test("ATTACK: an unknown email yields nothing, never the nearest record", async () => {
  freshEnv();
  assert.ok(!(await store.getSubscriptionByEmail("nobody@example.com")), "a near miss must be a miss, never a neighbour");
});

// the admin customer directory cannot be reached without passing the guard
test("ATTACK: the admin customer directory is unreachable without the admin guard", async () => {
  // Source-level, because the route cannot be module-loaded (see the note at
  // the top). The attack this repels: someone deletes or bypasses the guard
  // and the customer directory becomes world-readable. Three things must hold
  // together - the guard is imported, it is CALLED with the read permission
  // before any data is fetched, and every record still passes through the
  // metadata projection so even an authorised caller cannot pull content.
  const src = readFileSync("src/app/api/admin/customers/route.ts", "utf8");
  assert.ok(src.includes("requireAdmin"), "the admin guard must be imported");
  assert.match(src, /await requireAdmin\(\s*"customers\.read"\s*\)/, "the guard must be awaited with the read permission");
  assert.ok(src.includes("toAdminCustomerMetadata"), "records must pass the metadata projection");
  const guardAt = src.indexOf("requireAdmin(");
  const fetchAt = src.indexOf("getAdminCustomers(");
  assert.ok(guardAt > -1 && fetchAt > -1 && guardAt < fetchAt, "the guard must run BEFORE any customer data is fetched");
});

// a tampered signature is rejected outright
test("ATTACK: a tampered signature is rejected outright", async () => {
  freshEnv();
  const body = JSON.stringify({
    type: "subscription.active",
    data: {
      customer: { customer_id: "cus_attack6", email: "attack6@example.com" },
      subscription_id: "sub_attack6",
      product_id: "prod_c",
    },
  });
  const id = "evt_attack6";
  const ts = String(Math.floor(Date.now() / 1000));
  // Signature computed over a DIFFERENT payload than the one sent.
  const tamperedSig = sign(id, ts, body + "x");
  const req = new Request("https://mira.vualet.com/api/webhooks/dodo", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": ts,
      "webhook-signature": tamperedSig,
    },
    body,
  });
  const res = await readJson(await dodoRoute.POST(req));
  assert.ok(res.status === 400 || res.status === 401, "an unverified event must be refused");
  assert.ok(!(await store.getSubscription("cus_attack6")), "an unverified event must change nothing");
});
