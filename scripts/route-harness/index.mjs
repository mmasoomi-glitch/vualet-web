/**
 * Test harness for the real Mira revenue-path route handlers.
 *
 * Usage (from a scripts/*-test.mjs file):
 *   import { loadRoute, jsonRequest, readJson, netCalls } from "./route-harness/index.mjs";
 *   const { POST } = await loadRoute("src/app/api/checkout/route.ts");
 *
 * What is REAL here: the route handler, store.ts, dodo.ts, promo.ts,
 * promo-core.mjs, session.ts, connect-token.ts, stripe.ts's config gates, and
 * NextResponse.
 * What is FAKED here: exactly three boundaries — the `stripe` npm SDK (stubs/),
 * `next/headers` cookies() (stubs/), and global fetch (below). Nothing else.
 */
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

register("./hooks.mjs", import.meta.url);

// Force the in-memory store before src/lib/store.ts can be imported: it reads
// these at MODULE load, not per call, so a stray shell value would otherwise
// point tests at a real Upstash/db and make results non-deterministic.
delete process.env.MIRA_STORE_FILE;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

// ── network kill switch ───────────────────────────────────────────────────
// Every outbound fetch is recorded and BLOCKED unless a test explicitly
// scripts a reply. Dodo (createDodoCheckout) and Upstash both go through
// global fetch, so an accidental live call fails the test instead of hitting
// the real payment provider. `netCalls` is also the positive evidence used to
// assert "no charge was attempted".
export const netCalls = [];
let scriptedFetch = null;

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  netCalls.push({ url, method: init?.method ?? "GET", body: init?.body });
  if (scriptedFetch) return scriptedFetch(url, init);
  throw new Error(
    `[route-harness] BLOCKED outbound network call to ${url} — tests never talk to a live provider.`,
  );
};
export const __realFetch = realFetch;

/** Script the next outbound fetch replies. Pass null to go back to blocking. */
export function scriptFetch(fn) {
  scriptedFetch = fn;
}

export function resetNet() {
  netCalls.length = 0;
  scriptedFetch = null;
}

/**
 * Import a route module by repo-relative or absolute path.
 * `fresh` busts the ESM cache so module-level state (e.g. the /api/begin
 * in-memory rate-limit map) starts empty for a test that needs it.
 */
let freshCounter = 0;
export async function loadRoute(routePath, { fresh = false } = {}) {
  const abs = path.isAbsolute(routePath) ? routePath : path.join(ROOT, routePath);
  const url = pathToFileURL(abs).href + (fresh ? `?fresh=${++freshCounter}` : "");
  return import(url);
}

/** Build a POST Request with a JSON body (or a deliberately invalid one). */
export function jsonRequest(body, { url = "https://mira.vualet.com/api/test", headers = {} } = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Normalise a route's Response into { status, body }. */
export async function readJson(res) {
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/**
 * Deterministic env baseline. Clears every key the revenue path reads so a
 * developer's shell (or a stray real key) cannot change a test's meaning, then
 * applies the per-test overrides. DUMMY VALUES ONLY — never a real secret.
 */
const MANAGED = [
  "DODO_API_KEY", "DODO_MODE", "DODO_PAYMENTS_LIVE",
  "DODO_PRODUCT_COMPANION", "DODO_PRODUCT_ASSISTANT", "DODO_PRODUCT_STUDIO",
  "STRIPE_SECRET_KEY", "PAYMENTS_LIVE", "PROMO_CODES_ENABLED",
  "STRIPE_PRICE_COMPANION", "STRIPE_PRICE_ASSISTANT", "STRIPE_PRICE_STUDIO",
  "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "MIRA_STORE_FILE",
  "APP_URL", "NEXT_PUBLIC_APP_URL", "MIRA_WEB_URL",
];

export function env(overrides = {}) {
  for (const k of MANAGED) delete process.env[k];
  process.env.MIRA_TOKEN_SECRET = "test-token-secret";
  process.env.MIRA_SESSION_SECRET = "test-session-secret";
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
