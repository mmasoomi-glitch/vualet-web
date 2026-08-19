/**
 * Stub for the `stripe` npm SDK — the only outbound boundary the Stripe path
 * has that does NOT go through global fetch (the SDK uses node:https), so it
 * cannot be caught by the fetch interceptor and must be replaced at the module
 * level.
 *
 * src/lib/stripe.ts is otherwise untouched: paymentsConfigured(), appUrl(),
 * priceIdFor() and the client memoisation are all real production code. Because
 * stripe.ts memoises its client, every method reads `config` live at CALL time
 * so a test can change the scripted response between cases.
 *
 * Any Stripe method the code touches that a test has not scripted THROWS, so an
 * unexpected Stripe call can never be silently mistaken for a pass.
 */
export const calls = [];

export const config = {
  /** billingPortal.sessions.create -> object, or an Error instance to throw. */
  portalSession: { url: "https://billing.stripe.test/session/DEFAULT" },
  /** promotionCodes.list -> { data: [...] } */
  promotionCodes: { data: [] },
  /** prices.retrieve -> { unit_amount, currency } */
  price: { unit_amount: 1499, currency: "usd" },
};

export function reset() {
  calls.length = 0;
  config.portalSession = { url: "https://billing.stripe.test/session/DEFAULT" };
  config.promotionCodes = { data: [] };
  config.price = { unit_amount: 1499, currency: "usd" };
}

function record(method, args) {
  calls.push({ method, args });
}

export default class StripeStub {
  constructor(key, opts) {
    record("constructor", [key, opts]);
    this.__key = key;

    this.billingPortal = {
      sessions: {
        create: async (params) => {
          record("billingPortal.sessions.create", [params]);
          if (config.portalSession instanceof Error) throw config.portalSession;
          return config.portalSession;
        },
      },
    };

    this.promotionCodes = {
      list: async (params) => {
        record("promotionCodes.list", [params]);
        if (config.promotionCodes instanceof Error) throw config.promotionCodes;
        return config.promotionCodes;
      },
    };

    this.prices = {
      retrieve: async (id) => {
        record("prices.retrieve", [id]);
        if (config.price instanceof Error) throw config.price;
        return config.price;
      },
    };

    // Anything not scripted above must be loud, never silently undefined.
    return new Proxy(this, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === "symbol") return undefined;
        throw new Error(`[stripe-stub] unscripted Stripe surface accessed: ${String(prop)}`);
      },
    });
  }
}
