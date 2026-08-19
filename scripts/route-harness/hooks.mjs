/**
 * ESM resolve hooks that let plain `node --test` import the REAL Next.js App
 * Router route modules (src/app/api/**\/route.ts) outside of a Next build.
 *
 * Three things need rewriting, and ONLY three:
 *   1. `@/...`        — tsconfig `paths` alias Node knows nothing about  -> <root>/src/...
 *   2. `next/server`  — next has no `exports` map, so ESM subpath resolution
 *                       needs the explicit filename                     -> <root>/node_modules/next/server.js
 *   3. the two real network/context boundaries                          -> stubs/
 *        - `stripe`       (npm SDK: would open sockets to api.stripe.com)
 *        - `next/headers` (cookies(): needs a live Next request context)
 *
 * Everything else — store.ts, dodo.ts, promo.ts, promo-core.mjs, session.ts,
 * connect-token.ts and the route handlers themselves — is the untouched
 * production source. Resolution is ABSOLUTE (rooted at the repo, not at the
 * importer) so a route file copied outside the repo, e.g. an old revision in a
 * scratchpad for a counterfactual, still resolves.
 */
import { statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "src");
const STUBS = path.join(ROOT, "scripts", "route-harness", "stubs");

const HARD_MAP = new Map([
  ["next/server", path.join(ROOT, "node_modules", "next", "server.js")],
  ["next/headers", path.join(STUBS, "next-headers.mjs")],
  ["stripe", path.join(STUBS, "stripe-sdk.mjs")],
]);

// Order matters: exact path first, then TS/ESM extensions, then index files.
const EXTS = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", "/index.ts", "/index.mjs"];

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, nextResolve) {
  const hard = HARD_MAP.get(specifier);
  if (hard) return { url: pathToFileURL(hard).href, shortCircuit: true };

  if (specifier.startsWith("@/")) {
    const base = path.join(SRC, specifier.slice(2));
    for (const ext of EXTS) {
      if (isFile(base + ext)) {
        return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    throw new Error(`[route-harness] cannot resolve alias ${specifier} under ${SRC}`);
  }

  return nextResolve(specifier, context);
}
