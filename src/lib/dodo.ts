/**
 * DODO PAYMENTS — server-side client + config for Mira subscriptions.
 *
 * Merchant-of-Record provider (replaces the Stripe money path). We talk to the
 * REST API directly with fetch (no SDK dependency) so the surface is small and
 * auditable. Verified API shape (docs.dodopayments.com, 2026-07):
 *   - Base URL:  https://test.dodopayments.com | https://live.dodopayments.com
 *   - Auth:      Authorization: Bearer <API key>
 *   - Create:    POST /subscriptions  { product_id, quantity, customer, billing,
 *                return_url, payment_link:true, trial_period_days, metadata }
 *                → { payment_link, ... }
 *   - Webhooks:  Standard Webhooks spec (see dodo-webhook-core.mjs)
 *
 * Config (all from env / runtime.conf — NEVER hard-coded):
 *   DODO_API_KEY               the secret API key (env.txt: DODOPAYMENTS_API)
 *   DODO_MODE                  "test" | "live"  (default "test")
 *   DODO_PAYMENTS_LIVE         "1" to open the money path (fail-safe gate, mirrors
 *                              the Stripe PAYMENTS_LIVE pattern — coming-soon otherwise)
 *   DODO_PRODUCT_COMPANION     Dodo product id for the $14.99 tier
 *   DODO_PRODUCT_ASSISTANT     Dodo product id for the $39 tier
 *   DODO_PRODUCT_STUDIO        Dodo product id for the $79 tier
 *   DODO_WEBHOOK_SECRET        Standard-Webhooks signing secret (whsec_…)
 */

export type PaidPlan = "companion" | "assistant" | "studio";

const PRODUCT_ENV: Record<PaidPlan, string> = {
  companion: "DODO_PRODUCT_COMPANION",
  assistant: "DODO_PRODUCT_ASSISTANT",
  studio: "DODO_PRODUCT_STUDIO",
};

export function isPaidPlan(v: unknown): v is PaidPlan {
  return v === "companion" || v === "assistant" || v === "studio";
}

/** Dodo product id configured for a plan, or undefined if unset. */
export function productIdFor(plan: PaidPlan): string | undefined {
  return process.env[PRODUCT_ENV[plan]];
}

/**
 * Reverse map: a Dodo product id → our plan, or null (never a guessed plan).
 *
 * THIS IS THE WEBHOOK'S TIER AUTHORITY (decisions#341 Q3). It is the function
 * `activateDodo` takes as its `planForProductId` dependency so the tier granted
 * is the tier of the product Dodo actually charged for, rather than whatever
 * our own (possibly stale, possibly absent) record happened to say. It sits
 * here, in the env-reading module, so src/lib/dodo-webhook-core.mjs stays pure
 * and testable — the same split stripe.ts/plan-core.mjs already uses.
 *
 * Returning null is meaningful, not a failure: the caller answers an
 * unresolvable product with the ruled safe-and-generous fallback (lowest paid
 * tier + a loud alert), never by refusing a paying customer.
 */
export function planForProductId(productId: string | null | undefined): PaidPlan | null {
  if (!productId) return null;
  for (const plan of Object.keys(PRODUCT_ENV) as PaidPlan[]) {
    if (process.env[PRODUCT_ENV[plan]] && process.env[PRODUCT_ENV[plan]] === productId) {
      return plan;
    }
  }
  return null;
}

/**
 * ISO-3166-1 alpha-2 — the officially assigned two-letter country codes, used
 * as an ALLOWLIST for the billing country (jury item 3, tax jurisdiction).
 *
 * WHY AN ALLOWLIST AND NOT A REGEX. Dodo is the MERCHANT OF RECORD: it computes
 * the VAT / sales tax it charges from `billing.country`, so that field is an
 * input to the final amount the customer pays. It used to flow from the request
 * body straight into the Dodo call with no allowlist, no ISO validation and no
 * length cap, which means a direct API caller — the browser is not the only
 * thing that can POST /api/checkout — could influence their own tax by
 * naming a jurisdiction. `/^[A-Z]{2}$/` would let "XX" and "ZZ" through, and an
 * unassigned code is exactly the kind of value a provider may silently treat as
 * "no tax". Only a real jurisdiction is accepted.
 */
export const ISO_3166_1_ALPHA2: ReadonlySet<string> = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI " +
    "BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN " +
    "CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK " +
    "FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM " +
    "HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN " +
    "KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK " +
    "ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP " +
    "NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF " +
    "TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI " +
    "VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

/**
 * The billing country used when the caller supplies NONE. This is the historical
 * default and it stays exactly as it was: the checkout page has never sent a
 * country, so every real order today takes this branch, and changing it would
 * change the tax charged to live customers — the very defect being fixed.
 */
export const DEFAULT_BILLING_COUNTRY = "AE";

/**
 * Validate a SUPPLIED billing country; pass an ABSENT one through to the
 * historical default.
 *
 * An invalid country is a REFUSAL (throw), never a silent coercion to
 * DEFAULT_BILLING_COUNTRY. Quietly rewriting someone's tax jurisdiction to
 * ours is its own defect: it would charge a customer UAE VAT on an order they
 * told us was somewhere else, and it would hide the bad input from the logs.
 *
 * Case and surrounding whitespace are normalised ("ae", " AE " → "AE").
 * That is not coercion — it is the SAME jurisdiction the caller named. A
 * value that is not a real ISO-3166-1 alpha-2 code is refused outright.
 *
 * `unknown` rather than `string | undefined` on purpose: this value originates
 * in a JSON request body, where the declared TypeScript type is a promise the
 * network never made. `{"country": 971}` reaches here as a number.
 */
export function normalizeBillingCountry(country?: unknown): string {
  // ABSENT — unchanged behaviour. `""` was falsy under the old
  // `input.country || "AE"` and is still treated as "not supplied".
  if (country === undefined || country === null || country === "") return DEFAULT_BILLING_COUNTRY;

  const code = typeof country === "string" ? country.trim().toUpperCase() : "";
  if (code.length !== 2 || !ISO_3166_1_ALPHA2.has(code)) {
    throw new Error(
      `invalid billing country ${JSON.stringify(String(country).slice(0, 16))}: ` +
        `expected an ISO-3166-1 alpha-2 code`,
    );
  }
  return code;
}

/** Longest customer name we will send to Dodo. */
const MAX_CUSTOMER_NAME = 100;

/**
 * Bound the customer name that goes to the provider.
 *
 * `name` came off the request body unbounded too. It does not move money, so
 * unlike the country it is not worth refusing an order over — but an
 * unbounded, control-character-carrying string being posted to a payment
 * provider is a needless liability, and a name is not a payload. Control
 * characters are stripped, runs of whitespace collapsed, and the result capped;
 * an empty result falls back rather than sending Dodo a blank name (which its
 * `create_new_customer` shape rejects 422).
 */
export function boundedCustomerName(name: unknown, fallback: string): string {
  const clean = (v: unknown): string => {
    if (typeof v !== "string") return "";
    // Control characters become a SPACE rather than vanishing: deleting the
    // newline out of "Ada\nLovelace" would fuse it into "AdaLovelace" and
    // quietly change the customer's name. A character map rather than a
    // control-range RegExp keeps a \u0000-literal out of a regex for a linter
    // to flag; the collapse on the next line tidies the result.
    const printable = Array.from(v).map((ch) => (ch >= " " && ch !== "\u007F" ? ch : " ")).join("");
    return printable.replace(/\s+/g, " ").trim().slice(0, MAX_CUSTOMER_NAME).trim();
  };
  return clean(name) || clean(fallback) || "Mira Subscriber";
}

function dodoBaseUrl(): string {
  return process.env.DODO_MODE === "live"
    ? "https://live.dodopayments.com"
    : "https://test.dodopayments.com";
}

/**
 * Fail-safe gate — mirrors Stripe's paymentsConfigured(). Money path stays OFF
 * (checkout → "coming soon" 503) unless the API key AND the plan's product id
 * exist AND DODO_PAYMENTS_LIVE is explicitly "1". This keeps mira.vualet.com off
 * the money path until counsel/dashboard are ready, exactly like the Stripe gate.
 */
export function dodoConfigured(plan?: PaidPlan): boolean {
  if (!process.env.DODO_API_KEY) return false;
  if (process.env.DODO_PAYMENTS_LIVE !== "1") return false;
  if (plan && !productIdFor(plan)) return false;
  return true;
}

export function appUrl(): string {
  return process.env.MIRA_WEB_URL || "https://mira.vualet.com";
}

/**
 * THE ADVERTISED FREE TRIAL, AS CODE — the single named constant this module
 * (and the tests, and the public copy) is checked against.
 *
 * WHY THIS CONSTANT EXISTS AT ALL. "14-day free trial" / "no charge for 14
 * days" is a PROMISE printed on eight public pages. Until now nothing in this
 * repository made it true: the trial was configured at PRODUCT level in the
 * Dodo dashboard (all three products carry trial_period_days: 14,
 * trial_type: "free", trial_amount: null — verifications#411), the create call
 * below sent no trial field at all, and every subscription simply INHERITED the
 * product's setting. The code was not wrong; it was silent. One dashboard edit
 * turned "no charge for 14 days" into an immediate charge, and nothing failed,
 * nothing logged and nothing alerted — the promise had no owner in code.
 *
 * WHY SENDING IT IS SAFE TODAY. Dodo's CreateSubscriptionRequest accepts
 * `trial_period_days` (integer | null), documented as "Optional trial period in
 * days. If specified, this value overrides the trial period set in the
 * product's price." Subscription-level OVERRIDES product-level, and the value
 * we send is the value the products already carry, so this is IDEMPOTENT with
 * the current configuration: nothing observable changes for any customer today.
 * What changes is durability — the promise now survives a dashboard edit,
 * because the request no longer asks the dashboard what the answer is.
 *
 * This constant is deliberately NOT imported by the account/marketing pages:
 * @/lib/dodo is a server-only module (it reads DODO_API_KEY and calls the Dodo
 * API), and pulling it into a "use client" bundle to render the digit 14 would
 * be a worse defect than the one being fixed. The copy is instead tied to this
 * constant by TEST — scripts/dodo-trial-test.mjs reads TRIAL_PERIOD_DAYS from
 * here and asserts the public pages say the same number, so the two cannot
 * drift apart silently in either direction.
 */
export const TRIAL_PERIOD_DAYS = 14;

/**
 * WHAT DODO ACTUALLY ECHOES BACK, AND WHAT IT DOES NOT (gotchas#264).
 *
 * VERIFIED against the POST /subscriptions reference. CreateSubscriptionResponse
 * carries exactly: subscription_id, recurring_pre_tax_amount, customer, metadata,
 * addons, payment_id, client_secret, discount_id (deprecated), discount_ids,
 * expires_on, one_time_product_cart, payment_link, trial_amount.
 *
 * `trial_period_days` IS NOT IN THAT LIST. It is accepted on the REQUEST and is
 * never returned on the RESPONSE. The consequence has to be said plainly rather
 * than left for someone to discover: THE TRIAL-LENGTH CHECK ON THE CHECKOUT
 * RESPONSE IS CURRENTLY UNFALSIFIABLE. checkTrialPromise() returns
 * verified:false for every real checkout, forever, and can never fire in either
 * direction. It is NOT active protection and must not be counted as any.
 *
 * That is a deliberate, safe no-op rather than a bug: treating the absent field
 * as a violation would false-alarm on every single checkout, which is how alarms
 * get ignored. But a check that cannot fail is not a guard, so two real ones
 * exist instead:
 *
 *   1. `trial_amount` IS echoed, and a free trial reports it as null (verified
 *      on all three live products). A NON-ZERO trial_amount means the customer
 *      is being charged to start a trial we advertise as free. checkFreeTrial()
 *      tests exactly that, on the checkout path, and it CAN fire today.
 *
 *   2. The real risk — someone editing the trial off a PRODUCT in the Dodo
 *      dashboard — is checked directly against GET /products/{id}, which DOES
 *      return trial_period_days. See verifyTrialProducts() below. That check can
 *      genuinely fail, costs the checkout path nothing, and is where
 *      checkTrialPromise() earns its place.
 */

/** The verdict shape shared by every trial check in this module. */
export type TrialPromiseVerdict = {
  /** Was the value present at all, so the promise was CHECKABLE? */
  verified: boolean;
  /** Did the value CONTRADICT what we advertise? */
  violated: boolean;
  /** The value observed, or null when there was none. */
  observed: number | null;
};

/**
 * Pure verdict on a trial LENGTH.
 *
 * ABSENCE IS NOT EVIDENCE HERE — a missing value means "this source could not
 * tell us", not "there is no trial". That is why this returns a three-state
 * verdict instead of a boolean, and it is what keeps the (permanently
 * unverifiable) checkout-response call site quiet instead of screaming forever.
 *
 * The SAME function is strict where strictness is warranted: verifyTrialProducts
 * treats verified:false as a problem, because GET /products/{id} is documented
 * to return trial_period_days, so a product that reports none really does have
 * none. Same predicate, opposite meaning of silence — and each call site says
 * which one it is rather than leaving the reader to infer it.
 *
 * 0 counts as wrong: an explicit zero-day trial is precisely "charge them now".
 */
export function checkTrialPromise(
  raw: unknown,
  expected: number = TRIAL_PERIOD_DAYS,
): TrialPromiseVerdict {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { verified: false, violated: false, observed: null };
  }
  return { verified: true, violated: raw !== expected, observed: raw };
}

/**
 * Pure verdict on whether the trial is actually FREE.
 *
 * This is the half of the response check that is REAL. `trial_amount` IS in
 * CreateSubscriptionResponse, and a free trial reports it as null (verified on
 * all three live products, which carry trial_type "free" and trial_amount null).
 * A non-zero amount means we are charging someone to begin a trial that eight
 * public pages call free — a bigger lie than a wrong number of days, and one we
 * can detect on every single checkout starting today.
 *
 * Takes the whole response object rather than one field ON PURPOSE: `null` (a
 * free trial — the promise KEPT) and an absent key (nothing to check) are
 * different answers, and a bare value argument cannot tell them apart.
 */
export function checkFreeTrial(response: unknown): TrialPromiseVerdict {
  if (!response || typeof response !== "object" || !("trial_amount" in response)) {
    return { verified: false, violated: false, observed: null };
  }
  const raw = (response as { trial_amount?: unknown }).trial_amount;
  // The verified free-trial shape: present, and null.
  if (raw === null) return { verified: true, violated: false, observed: null };
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return { verified: true, violated: raw !== 0, observed: raw };
  }
  // Present but not a shape we recognise — reported as uncheckable rather than
  // guessing that an unfamiliar type means a charge.
  return { verified: false, violated: false, observed: null };
}

/** Both response-side checks, and whether either actually contradicted us. */
export type TrialResponseAudit = {
  /** Trial LENGTH. Permanently verified:false — Dodo does not echo the field. */
  length: TrialPromiseVerdict;
  /** Trial FREE-NESS. Falsifiable today: trial_amount IS echoed. */
  free: TrialPromiseVerdict;
  violated: boolean;
};

/**
 * Audit the created subscription against the promise, and SCREAM if it differs.
 *
 * ALERT, NOT THROW — a deliberate choice, and here is the reasoning.
 *
 * By the time this runs the subscription ALREADY EXISTS at Dodo: it was created
 * by the POST above, and this function is reading that call's response.
 * Throwing here does not un-create it and does not stop any charge. All a throw
 * would accomplish is to withhold the payment_link from the customer, leaving a
 * live Dodo subscription attached to a person who never reached a checkout page
 * and never agreed to anything — a strictly worse outcome for that customer
 * than the mis-set trial being guarded against, and a support/chargeback mess
 * on top. Refusing would also punish the customer for OUR misconfiguration: the
 * only party who can put a wrong trial on a product is us.
 *
 * WHAT ACTUALLY HAPPENS WHEN THIS FIRES — read this before treating it as a
 * safety net. This product has NO alerting infrastructure: there is no Sentry,
 * Datadog, PagerDuty, Opsgenie, Slack webhook or log shipper anywhere in this
 * repository or its dependencies. Concretely:
 *
 *   - The message goes to the stderr of the Next server, which on the live box
 *     is the systemd unit `mira-web`. It is readable with
 *     `journalctl -u mira-web` and by nothing else.
 *   - NOBODY IS PAGED. No email is sent, no ticket is opened, no dashboard turns
 *     red, and there is no on-call rota to notice. If no human runs journalctl,
 *     this line is seen by no one, possibly ever.
 *   - It is therefore a BLACK-BOX RECORDER, not an alarm: it explains what went
 *     wrong to whoever is ALREADY investigating, and it starts no investigation.
 *
 * That is the honest description, and it is exactly why the check a human
 * actually encounters is a separate, runnable one: `npm run verify:trial`
 * (scripts/verify-trial-config.mjs) reads the products straight from Dodo and
 * EXITS NON-ZERO on drift, so it fails a terminal, a cron job or a CI step —
 * places where failure is noticed by construction. Wiring a real pager is out of
 * scope here, and inventing one would be worse than writing this down.
 *
 * `alert` is injected, defaulting to console.error, purely so tests can PROVE
 * the alert fired rather than watch a console.
 */
export function assertTrialPromise(
  response: unknown,
  ctx: { plan: PaidPlan; subscriptionId?: string; productId?: string },
  alert: (...args: unknown[]) => void = (...args) => console.error(...args),
): TrialResponseAudit {
  const where =
    `plan "${ctx.plan}" (product=${ctx.productId ?? "unknown"}, ` +
    `subscription=${ctx.subscriptionId ?? "unknown"})`;

  const length = checkTrialPromise(
    response && typeof response === "object"
      ? (response as { trial_period_days?: unknown }).trial_period_days
      : undefined,
  );
  const free = checkFreeTrial(response);

  // In practice only this branch can be reached from a real checkout.
  if (free.violated) {
    alert(
      `[dodo] ALERT ADVERTISED-TRIAL VIOLATION (not free): ${where} was created with ` +
        `trial_amount=${free.observed}, but a free trial reports trial_amount null or 0. Eight public ` +
        `pages promise a ${TRIAL_PERIOD_DAYS}-day FREE trial; this customer is being charged to start ` +
        `one. The checkout was ALLOWED THROUGH on purpose — the subscription already exists, so ` +
        `refusing here would only strand them without a payment link. Run "npm run verify:trial" and ` +
        `FIX THE PRODUCT TRIAL CONFIG URGENTLY.`,
    );
  }
  // Kept because it costs nothing and would start working the day Dodo adds the
  // field to the response schema. Today it is unreachable; see the header above.
  if (length.violated) {
    alert(
      `[dodo] ALERT ADVERTISED-TRIAL VIOLATION (wrong length): we sent ` +
        `trial_period_days=${TRIAL_PERIOD_DAYS} for ${where} but Dodo reported ` +
        `trial_period_days=${length.observed}. Run "npm run verify:trial" and FIX IT URGENTLY.`,
    );
  }
  return { length, free, violated: free.violated || length.violated };
}

/**
 * THE PRODUCT-LEVEL CHECK — the one that can actually fail.
 *
 * The risk this whole section exists for is A DASHBOARD EDIT TO A PRODUCT.
 * Products are directly readable: GET /products/{id} returns trial_period_days,
 * trial_type and trial_amount, which is how all three were confirmed as a
 * 14-day free trial in the first place. So the promise is checked against the
 * thing that can change, rather than against a response field that never
 * arrives.
 *
 * DELIBERATELY NOT ON THE CHECKOUT PATH. This makes one network call per product
 * and belongs on demand or on a schedule (`npm run verify:trial`), never in
 * createDodoCheckout — three extra round trips in front of a paying customer
 * would trade a real conversion for a check that does not need to be live.
 */
export const TRIAL_TYPE_FREE = "free";

/** One product's verdict. `problems` is empty exactly when the product is right. */
export type TrialProductVerdict = {
  plan: PaidPlan;
  productId: string | null;
  ok: boolean;
  problems: string[];
  observed: { trialPeriodDays: unknown; trialType: unknown; trialAmount: unknown } | null;
};

export type TrialConfigReport = {
  ok: boolean;
  checked: number;
  verdicts: TrialProductVerdict[];
  problems: string[];
};

/**
 * Pure check of ONE product payload against the advertised promise.
 *
 * ABSENCE IS EVIDENCE HERE, unlike on the checkout response, and the asymmetry
 * is intentional: GET /products/{id} is documented to return these fields, so a
 * product that reports no trial_period_days genuinely HAS no trial. Silence from
 * a source that is supposed to answer is an answer.
 */
export function checkTrialProduct(plan: PaidPlan, productId: string | null, product: unknown): TrialProductVerdict {
  const problems: string[] = [];
  if (!productId) {
    return { plan, productId: null, ok: false, problems: [`no product id configured (${PRODUCT_ENV[plan]} unset)`], observed: null };
  }
  if (!product || typeof product !== "object") {
    return { plan, productId, ok: false, problems: ["product could not be read from Dodo"], observed: null };
  }

  const p = product as { trial_period_days?: unknown; trial_type?: unknown; trial_amount?: unknown };
  const observed = { trialPeriodDays: p.trial_period_days, trialType: p.trial_type, trialAmount: p.trial_amount };

  const length = checkTrialPromise(p.trial_period_days);
  if (!length.verified) {
    problems.push(`no trial_period_days on the product — it advertises ${TRIAL_PERIOD_DAYS} days but grants none`);
  } else if (length.violated) {
    problems.push(`trial_period_days is ${length.observed}, but we advertise ${TRIAL_PERIOD_DAYS}`);
  }

  if (p.trial_type !== TRIAL_TYPE_FREE) {
    problems.push(`trial_type is ${JSON.stringify(p.trial_type ?? null)}, but we advertise a "${TRIAL_TYPE_FREE}" trial`);
  }

  const free = checkFreeTrial(p);
  if (free.violated) {
    problems.push(`trial_amount is ${free.observed}, but a free trial must cost nothing`);
  }

  return { plan, productId, ok: problems.length === 0, problems, observed };
}

/**
 * Check every configured plan's product. NEVER THROWS — a failure to read one
 * product is itself a reported problem, not an exception that hides the other
 * two. `fetchProduct` is injected so the tests exercise this exact logic without
 * any network at all; scripts/verify-trial-config.mjs supplies the real one.
 */
export async function verifyTrialProducts(deps: {
  fetchProduct: (productId: string) => Promise<unknown>;
  plans?: readonly PaidPlan[];
}): Promise<TrialConfigReport> {
  const plans = deps.plans ?? (Object.keys(PRODUCT_ENV) as PaidPlan[]);
  const verdicts: TrialProductVerdict[] = [];

  for (const plan of plans) {
    const productId = productIdFor(plan) ?? null;
    if (!productId) {
      verdicts.push(checkTrialProduct(plan, null, null));
      continue;
    }
    let product: unknown = null;
    try {
      product = await deps.fetchProduct(productId);
    } catch (err) {
      verdicts.push({
        plan,
        productId,
        ok: false,
        problems: [`could not read the product from Dodo: ${err instanceof Error ? err.message : String(err)}`],
        observed: null,
      });
      continue;
    }
    verdicts.push(checkTrialProduct(plan, productId, product));
  }

  const problems = verdicts.flatMap((v) => v.problems.map((p) => `${v.plan} (${v.productId ?? "no product id"}): ${p}`));
  return { ok: problems.length === 0, checked: verdicts.length, verdicts, problems };
}

/**
 * The REAL product read: GET /products/{id}. Used only by
 * scripts/verify-trial-config.mjs — never from the checkout path.
 */
export async function fetchDodoProduct(productId: string): Promise<unknown> {
  const apiKey = process.env.DODO_API_KEY;
  if (!apiKey) throw new Error("DODO_API_KEY unset");
  const res = await fetch(`${dodoBaseUrl()}/products/${encodeURIComponent(productId)}`, {
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Dodo get-product failed ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

export interface DodoCheckoutInput {
  plan: PaidPlan;
  email?: string;
  name?: string;
  connectToken: string;
  /**
   * ISO-3166-1 alpha-2 country for MoR tax (billing.country is required by
   * Dodo). VALIDATED against ISO_3166_1_ALPHA2 — an unrecognised code is
   * refused, not coerced. Omit it to keep DEFAULT_BILLING_COUNTRY.
   */
  country?: string;
}

/**
 * Create a subscription payment link for a Mira plan. Carries connect_token +
 * plan in metadata so the webhook can bind the purchase to the Telegram bot and
 * activate the correct tier (same contract as the Stripe path). Returns the
 * hosted checkout URL. Throws on a non-2xx or a missing payment_link.
 */
export async function createDodoCheckout(input: DodoCheckoutInput): Promise<{ url: string; subscriptionId?: string }> {
  const apiKey = process.env.DODO_API_KEY;
  if (!apiKey) throw new Error("DODO_API_KEY unset");
  const productId = productIdFor(input.plan);
  if (!productId) throw new Error(`no Dodo product id configured for plan ${input.plan}`);

  // TAX JURISDICTION, resolved BEFORE any network call: an invalid country
  // throws here, so no subscription is created and nothing is charged — a
  // refusal, not a silent coercion to our own default. An ABSENT country keeps
  // the historical default, which is the path every order placed from the
  // checkout page takes today (the page sends no country at all).
  const country = normalizeBillingCountry(input.country);

  // Dodo's `customer` is an untagged enum: a NEW customer needs email + name +
  // create_new_customer:true (bare {email} is rejected 422). Derive a display
  // name from the email local-part when the caller didn't supply one — and
  // bound it either way, since it too arrives unvalidated off a request body.
  const email = input.email;
  const name = boundedCustomerName(input.name, email ? email.split("@")[0] : "Mira Subscriber");
  const body = {
    product_id: productId,
    quantity: 1,
    payment_link: true,
    return_url: `${appUrl()}/mira/welcome?token=${input.connectToken}`,
    customer: email
      ? { email, name, create_new_customer: true }
      : { email: "guest@vualet.com", name: "Mira Subscriber", create_new_customer: true },
    billing: {
      country,
      city: "NA",
      state: "NA",
      street: "NA",
      zipcode: "00000",
    },
    // THE ADVERTISED TRIAL, SENT EXPLICITLY (see TRIAL_PERIOD_DAYS above).
    // Subscription-level overrides product-level, and the value equals what the
    // products already carry, so this is idempotent with today's configuration
    // and changes nothing for any customer — it just stops the promise from
    // depending on a dashboard toggle that no code and no test ever asserted.
    trial_period_days: TRIAL_PERIOD_DAYS,
    metadata: { connect_token: input.connectToken, plan: input.plan },
  };

  const res = await fetch(`${dodoBaseUrl()}/subscriptions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Dodo create-subscription failed ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    payment_link?: string;
    subscription_id?: string;
    // CreateSubscriptionResponse carries trial_amount but NOT trial_period_days
    // (gotchas#264). The latter is kept in the type only to document that we
    // looked for it and it is not there — see the trial section above.
    trial_amount?: number | null;
    trial_period_days?: number | null;
  };
  if (!json.payment_link) throw new Error("Dodo returned no payment_link");

  // Did Dodo actually create the subscription on the terms we advertise? Only
  // the FREE-NESS half of this can fire (trial_amount is echoed; the length is
  // not — gotchas#264), and it alerts rather than refusing; see
  // assertTrialPromise for both limits, stated in full. The check that can
  // genuinely catch a dashboard edit is verifyTrialProducts, run off this path
  // by `npm run verify:trial`.
  assertTrialPromise(json, { plan: input.plan, subscriptionId: json.subscription_id, productId });

  return { url: json.payment_link, subscriptionId: json.subscription_id };
}

/**
 * Cancel a Dodo subscription (defect E, jury #102).
 *
 * Defaults to cancel_at_next_billing_date=true so the customer keeps what they
 * already paid for until the end of the period they bought — cancelling should
 * stop future billing, not confiscate the current month.
 *
 * PATCH /subscriptions/{id} — see Dodo API reference. cancel_reason is an enum;
 * "cancelled_by_customer" is the correct value for a self-serve cancellation.
 */
export async function cancelDodoSubscription(
  subscriptionId: string,
  opts: { atPeriodEnd?: boolean; comment?: string } = {},
): Promise<{ ok: true }> {
  const apiKey = process.env.DODO_API_KEY;
  if (!apiKey) throw new Error("DODO_API_KEY unset");
  if (!subscriptionId) throw new Error("subscriptionId required");

  const body: Record<string, unknown> = {
    cancel_at_next_billing_date: opts.atPeriodEnd !== false,
    cancel_reason: "cancelled_by_customer",
  };
  if (opts.comment) body.cancellation_comment = opts.comment.slice(0, 3000);

  const res = await fetch(`${dodoBaseUrl()}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Dodo cancel-subscription failed ${res.status}: ${detail.slice(0, 300)}`);
  }
  return { ok: true };
}

/**
 * Refund a Dodo payment (defect E, jury #102).
 *
 * DELIBERATELY NOT REACHABLE FROM A CUSTOMER-FACING ROUTE. The jury ruled that
 * cancellation is the customer's own right and may be self-serve, but a refund
 * moves real money OUT and is a fraud surface — so it stays behind human
 * approval. This function exists so an authorised operator path can call it;
 * do not wire it directly to an unauthenticated or customer-triggered endpoint.
 *
 * POST /refunds — payment_id is required; omitting items refunds the whole payment.
 */
export async function refundDodoPayment(
  paymentId: string,
  opts: { reason?: string } = {},
): Promise<{ refundId?: string; status?: string }> {
  const apiKey = process.env.DODO_API_KEY;
  if (!apiKey) throw new Error("DODO_API_KEY unset");
  if (!paymentId) throw new Error("paymentId required");

  const body: Record<string, unknown> = { payment_id: paymentId };
  if (opts.reason) body.reason = opts.reason.slice(0, 3000);

  const res = await fetch(`${dodoBaseUrl()}/refunds`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Dodo refund failed ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { refund_id?: string; status?: string };
  return { refundId: json.refund_id, status: json.status };
}
