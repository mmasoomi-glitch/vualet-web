/**
 * SUPPORT CORE — what the customer-service bot is allowed to say about a
 * customer's OWN order, and what it hands a human when a refund is requested.
 *
 * Pure and injectable, matching promo-core.mjs / webhook-core.mjs: no env reads,
 * no network, no store access. Everything it needs arrives as an argument, so
 * the TypeScript route and scripts/support-core-test.mjs run the identical code
 * path with zero live dependencies.
 *
 * ── THE BOUNDARY (jury #107, constraint 3) ────────────────────────────────────
 * The bot may READ the customer's own order state and may FILE a refund request
 * carrying their stated reason. It must NEVER decide whether a refund reason is
 * legitimate, never score or rank a claim's credibility, and never tell a
 * customer their claim looks false. It summarises; a human decides.
 *
 * That boundary is enforced STRUCTURALLY here, not by a flag:
 *   - refundContext() ends in assertNeutralContext(), which throws unless the
 *     produced object's key set is EXACTLY REFUND_CONTEXT_KEYS, and throws on
 *     any key whose name smells like judgement (score / risk / legitimacy /
 *     recommendation / verdict / confidence …). Adding a "fraudScore" field
 *     would not ship — it would throw on the first call. To cross this line you
 *     must DELETE the guard, which is a visible, reviewable act.
 *   - summariseOrderForCustomer() ends in assertNoInternals(), which throws if
 *     the customer-facing text contains any internal identifier from the record
 *     or any provider/infrastructure name.
 *
 * Only KEY NAMES are ever inspected for judgement words. The customer's own
 * words are never scanned, never scored, never sanitised — they are carried
 * VERBATIM. A customer allowed to write "this felt like a scam" must have that
 * sentence reach a human unaltered.
 *
 * @typedef {Object} OrderRecordLike
 * @property {string} [plan]
 * @property {string} [status]
 * @property {string} [createdAt]
 * @property {string} [email]
 * @property {string} [token]
 * @property {string} [customerId]
 * @property {string} [subscriptionId]
 * @property {number} [telegramId]
 *
 * @typedef {Object} OrderSummary
 * @property {boolean} found
 * @property {string} planLabel
 * @property {string} statusLabel
 * @property {string} headline
 * @property {string} statusLine
 * @property {string} sinceLine
 * @property {string} cancelLine
 * @property {string} text
 *
 * @typedef {Object} RefundContext
 * @property {string} plan
 * @property {string} planLabel
 * @property {string} status
 * @property {string} statusLabel
 * @property {string|null} startedAt
 * @property {string} reasonVerbatim
 * @property {string} preparedAt
 */

/** Plain-language plan names. The customer never sees a slug or a price id. */
export const PLAN_LABELS = /** @type {const} */ ({
  companion: "Companion",
  assistant: "Assistant",
  studio: "Studio",
});

/** Plain-language order states. */
export const STATUS_LABELS = /** @type {const} */ ({
  pending: "Not started yet",
  bound: "Almost there",
  active: "Active",
  cancelled: "Cancelled",
});

/**
 * The COMPLETE key set of a refund context. Enforced at runtime, not suggested.
 * Anything outside this list is a boundary violation by construction.
 */
export const REFUND_CONTEXT_KEYS = Object.freeze([
  "plan",
  "planLabel",
  "status",
  "statusLabel",
  "startedAt",
  "reasonVerbatim",
  "preparedAt",
]);

/**
 * Key names that would mean we had started judging the customer. Matched
 * against KEYS ONLY — never against the customer's own words.
 */
const JUDGEMENT_KEY_PATTERN =
  /score|rating|rank|risk|legit|fraud|abus|suspic|credib|trust|recommend|verdict|judg|confidence|likelihood|probab|assess|approve|reject|deny|decision|eligib|valid|flag|priority|severity|sentiment/i;

/**
 * Names that would leak how the thing is built. The customer asked about their
 * plan, not our stack.
 */
const INTERNALS_PATTERN =
  /dodo|stripe|upstash|redis|vercel|hetzner|nginx|openrouter|anthropic|webhook|api[\s_-]?key|subscription[\s_-]?id|customer[\s_-]?id|\bsub_|\bcus_|\bpdt_|\bpay_/i;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "2026-08-05T01:00:00Z" -> "5 August 2026". Deterministic (UTC, no locale), so
 * the copy reads the same on the box as it does in a test.
 * @param {unknown} iso
 * @returns {string}
 */
export function friendlyDate(iso) {
  if (typeof iso !== "string" || !iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * @param {unknown} plan
 * @returns {string}
 */
export function planLabelFor(plan) {
  if (typeof plan !== "string") return "your plan";
  const key = plan.trim().toLowerCase();
  return (/** @type {Record<string,string>} */ (PLAN_LABELS))[key] || "your plan";
}

/**
 * @param {unknown} status
 * @returns {string}
 */
export function statusLabelFor(status) {
  if (typeof status !== "string") return "Unknown";
  const key = status.trim().toLowerCase();
  return (/** @type {Record<string,string>} */ (STATUS_LABELS))[key] || "Unknown";
}

/**
 * Throws if a customer-facing summary carries anything the customer should
 * never see: an identifier out of their own record, or the name of a provider
 * or piece of infrastructure. Called on every summary, so a future field that
 * quietly spreads the record fails loudly instead of leaking silently.
 *
 * @param {OrderSummary} summary
 * @param {OrderRecordLike|null|undefined} rec
 * @returns {OrderSummary}
 */
export function assertNoInternals(summary, rec) {
  const blob = JSON.stringify(summary);

  const secrets = [rec?.customerId, rec?.subscriptionId, rec?.token, rec?.telegramId]
    .filter((v) => v !== undefined && v !== null && String(v).length > 0)
    .map(String);

  for (const s of secrets) {
    if (blob.includes(s)) {
      throw new Error("support-core: refusing to return an internal identifier to a customer");
    }
  }

  const hit = blob.match(INTERNALS_PATTERN);
  if (hit) {
    throw new Error(
      `support-core: refusing to name internals in customer copy (matched "${hit[0]}")`,
    );
  }

  return summary;
}

/**
 * A warm, plain-language account of THEIR plan, where it stands, and what
 * happens if they cancel. Brother-voice: short, direct, no lecture, no jargon,
 * no ids, no provider names.
 *
 * A missing record is not an error — it is a person who deserves a straight
 * answer and a way forward.
 *
 * @param {OrderRecordLike|null|undefined} rec
 * @returns {OrderSummary}
 */
export function summariseOrderForCustomer(rec) {
  if (!rec || typeof rec !== "object") {
    return assertNoInternals(
      {
        found: false,
        planLabel: "None",
        statusLabel: "Unknown",
        headline: "I can't see a plan on this account.",
        statusLine:
          "That usually just means you signed up with a different email, or the order never finished going through.",
        sinceLine: "",
        cancelLine: "Tell me what you were trying to do and I'll get a person on it with you.",
        text: [
          "I can't see a plan on this account.",
          "That usually just means you signed up with a different email, or the order never finished going through.",
          "Tell me what you were trying to do and I'll get a person on it with you.",
        ].join(" "),
      },
      rec,
    );
  }

  const planLabel = planLabelFor(rec.plan);
  const status = typeof rec.status === "string" ? rec.status.trim().toLowerCase() : "";
  const statusLabel = statusLabelFor(status);
  const started = friendlyDate(rec.createdAt);

  const headline =
    planLabel === "your plan"
      ? "You're on a plan with us."
      : `You're on the ${planLabel} plan.`;

  let statusLine;
  let cancelLine;

  switch (status) {
    case "active":
      statusLine = "It's active right now, and it renews on its own each period.";
      cancelLine =
        "If you ever want to stop, you can cancel yourself in a click. You keep everything you've already paid for until the end of the period you're in, and there's no charge after that.";
      break;
    case "cancelled":
      statusLine =
        "It's cancelled, so nothing more will be charged. You still have it until the end of the period you already paid for.";
      cancelLine = "Nothing left to do here. If you want it back, you can start it up again any time.";
      break;
    case "bound":
      statusLine =
        "You're linked up and nearly there — we're just waiting on the payment to land before it switches on.";
      cancelLine =
        "If you'd rather not go ahead, nothing is locked in yet. Say the word and we'll stop it here.";
      break;
    case "pending":
      statusLine =
        "It hasn't started yet — the checkout never finished, so nothing has been charged.";
      cancelLine =
        "There's nothing to cancel, and you haven't paid anything. Whenever you're ready, you can pick up where you left off.";
      break;
    default:
      statusLine =
        "I can see your plan, but I can't tell you its exact state right now, and I'd rather not guess at your money.";
      cancelLine =
        "Let me put a person on this with you so you get a straight answer rather than my best guess.";
      break;
  }

  const sinceLine = started ? `You've been with us since ${started}.` : "";

  const text = [headline, statusLine, sinceLine, cancelLine].filter(Boolean).join(" ");

  return assertNoInternals(
    { found: true, planLabel, statusLabel, headline, statusLine, sinceLine, cancelLine, text },
    rec,
  );
}

/**
 * Throws unless the object is EXACTLY a neutral evidence bundle.
 *
 * This is the jury boundary made structural. It checks two things, both on KEY
 * NAMES only:
 *   1. the key set is exactly REFUND_CONTEXT_KEYS — no extra field can ride along
 *   2. no key name is a judgement word — no score, no risk, no recommendation
 *
 * It never inspects the customer's words. Their reason is evidence, not input
 * to a verdict.
 *
 * @param {Record<string, unknown>} ctx
 * @returns {RefundContext}
 */
export function assertNeutralContext(ctx) {
  const keys = Object.keys(ctx).sort();
  const expected = [...REFUND_CONTEXT_KEYS].sort();

  // Judgement check FIRST, so a field like "fraudScore" fails with the reason it
  // actually failed for, not with a generic shape complaint.
  for (const k of keys) {
    if (JUDGEMENT_KEY_PATTERN.test(k)) {
      throw new Error(
        `support-core: "${k}" is a judgement field. This bot does not adjudicate refunds; a human does.`,
      );
    }
  }

  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    throw new Error(
      `support-core: a refund context must be exactly [${expected.join(", ")}] — got [${keys.join(", ")}]`,
    );
  }

  return /** @type {RefundContext} */ (/** @type {unknown} */ (ctx));
}

/**
 * Build the neutral evidence bundle a HUMAN reads before deciding a refund.
 *
 * It states the facts of the order and repeats the customer's reason word for
 * word. It contains no opinion, no score, no recommendation and no assessment
 * of whether the reason is true — deliberately, and enforced above. The person
 * reviewing gets the evidence and makes the call themselves.
 *
 * The reason is carried VERBATIM: not trimmed, not lower-cased, not truncated,
 * not rewritten. Whatever the customer typed is what the reviewer reads.
 *
 * @param {OrderRecordLike|null|undefined} rec
 * @param {unknown} reason  the customer's own words, exactly as they gave them
 * @param {{ now?: () => Date }} [deps]  injected clock; nothing is read from env
 * @returns {RefundContext}
 */
export function refundContext(rec, reason, deps = {}) {
  const now = deps.now || (() => new Date());

  return assertNeutralContext({
    plan: typeof rec?.plan === "string" && rec.plan ? rec.plan : "unknown",
    planLabel: planLabelFor(rec?.plan),
    status: typeof rec?.status === "string" && rec.status ? rec.status : "unknown",
    statusLabel: statusLabelFor(rec?.status),
    startedAt: typeof rec?.createdAt === "string" && rec.createdAt ? rec.createdAt : null,
    reasonVerbatim: typeof reason === "string" ? reason : "",
    preparedAt: now().toISOString(),
  });
}
