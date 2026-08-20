/**
 * Stub for `next/headers`. The real cookies() requires a live Next request
 * context (AsyncLocalStorage) that does not exist under `node --test`.
 *
 * This stub fakes ONLY the cookie jar. The production src/lib/session.ts still
 * runs verbatim on top of it — real HMAC-SHA256 signing, real timing-safe
 * compare, real expiry check. Tests hand it genuine tokens minted by
 * createSessionToken(), so "signed in" in a test means the same thing it means
 * in production. A forged or absent cookie really does fail verification.
 */
const jar = new Map();

export const __cookies = {
  set(name, value) {
    jar.set(name, value);
  },
  clear() {
    jar.clear();
  },
};

export async function cookies() {
  return {
    get(name) {
      return jar.has(name) ? { name, value: jar.get(name) } : undefined;
    },
    getAll() {
      return [...jar].map(([name, value]) => ({ name, value }));
    },
    has: (name) => jar.has(name),
    set() {},
    delete() {},
  };
}

export async function headers() {
  return new Headers();
}
