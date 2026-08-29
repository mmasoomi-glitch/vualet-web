/**
 * ENGINE ENTITLEMENT PUSH — the immediacy half of decisions#342 Q_B.
 *
 * THE BUG THIS EXISTS TO CLOSE (gotchas#262). Flipping the web record to
 * "refunded" revokes NOTHING the customer can feel: the engine tenant keeps its
 * paid tier and its token credits, because setTenantStatus/setTenantEntitlement
 * were only ever called at bind time. A webhook that rewrites the web KV blob
 * and stops there LOOKS fixed and changes nothing about actual access.
 *
 * THE RULING. The jury refused both single-sided answers and ordered a hybrid:
 * the engine RE-RESOLVES entitlement per message (15s cache) and runs a
 * reconciliation sweep — that is the correctness layer — and the webhook PUSHES
 * the state change for immediacy. This module is the push, and the ordering of
 * those two words matters everywhere below: **a failed push is expected and
 * survivable**. It costs the customer a slower convergence, never a wrong one.
 * That is why nothing in here throws, nothing here is retried, and every
 * failure is logged in a shape that says so out loud.
 *
 * THE CONTRACT (built, tested and verified on the engine side — NOT redesigned
 * here; apps/engine/src/entitlement.mjs handleBillingPushRequest):
 *
 *     POST {base}/internal/billing/entitlement
 *     Authorization: Bearer <MIRA_BILLING_PUSH_SECRET>
 *     Content-Type: application/json
 *     { "tenantId" | "telegramId", "event", "plan"?, "eventId"?, "eventAt"? }
 *
 * Properties of that endpoint this module is designed against:
 *   - It FAILS CLOSED: every caller gets 401 until MIRA_BILLING_PUSH_SECRET is
 *     set to the SAME value on both sides. So an unset secret here is not an
 *     error to raise, it is a push not worth making — see pushDisabledReason().
 *   - It is CONVERGENT: a replay is a no-op, so re-pushing an already-applied
 *     revocation is free and is in fact the repair path for an earlier push
 *     that failed. This module therefore pushes on replays too.
 *   - It orders state BY PROVIDER EMISSION TIME, which is why eventAt is not
 *     decoration: a late-arriving dunning.recovered must not resurrect a
 *     cancelled customer. eventAt is ALWAYS the provider's emission stamp,
 *     never Date.now() — see engineEventAtIso().
 *   - On revoke it changes STATUS ONLY, never tier or credits, so a later
 *     restore is lossless.
 */

/** The endpoint path. Fixed by the engine; never configurable. */
export const ENGINE_PUSH_PATH = "/internal/billing/entitlement";

/**
 * Where the engine listens.
 *
 * DEFAULT IS LOOPBACK BECAUSE THE ENDPOINT IS LOOPBACK-BOUND
 * (whatsapp-gateway-v2.mjs listens on 127.0.0.1:8790 only — jury C4). It is
 * OVERRIDABLE because the two halves of this product are not on one machine:
 * the web app runs on the VPS 89.167.49.209 and the gateway on 23.88.59.31, so
 * "127.0.0.1:8790" only reaches the engine through the existing wa-tunnel SSH
 * forward that already runs on the web host (permitopen 127.0.0.1:8790,
 * docs/WA_V2_RUNBOOK.md). If that forward's local port is not 8790, set
 * MIRA_ENGINE_URL to the one it actually is. Guessing here would produce a push
 * that silently never lands — the exact failure this whole change exists to
 * stop — so the address is configuration, not a wish.
 */
export const DEFAULT_ENGINE_BASE_URL = "http://127.0.0.1:8790";

/**
 * An explicit, short deadline. An unbounded fetch inside a webhook handler is a
 * held Dodo connection and eventually a provider-side timeout and retry, so the
 * push gets a budget far smaller than any webhook timeout and loses the race
 * rather than delaying the 200.
 */
export const ENGINE_PUSH_TIMEOUT_MS = 3000;

/**
 * DODO EFFECT STATUS -> ENGINE EVENT NAME.
 *
 * READ THIS BEFORE CHANGING IT. The web's event vocabulary and the engine's are
 * NOT the same set, and four of ours are not in theirs: dispute.accepted,
 * dispute.expired, subscription.on_hold and dispute.cancelled would each come
 * back 400 unknown_event and change nothing. Forwarding the raw Dodo type would
 * therefore have been a push that reported success in the common case and
 * quietly did nothing in four real ones.
 *
 * So the translation is keyed on the ONE thing both sides already agree about:
 * the STATUS the effect table (DODO_EVENT_EFFECTS, dodo-webhook-core.mjs)
 * declares for that event. That table is the single mapping from event to
 * meaning; this is a wire-vocabulary lookup on its output, not a second policy
 * table to drift out of step with the first. Every key here is a `status` value
 * of some `kind: "revoke"` row, and scripts/dodo-webhook-test.mjs asserts that
 * correspondence in BOTH directions, so a new revoke row cannot be added
 * without a wire name.
 *
 * Each right-hand name is one the engine's REVOKE_EVENTS documents:
 *   refunded   -> refund.succeeded    (engine status "refunded")
 *   chargeback -> chargeback          (engine status "chargeback")
 *   on_hold    -> dunning.exhausted   (engine status "cancelled" — the engine
 *                 has no on_hold status, and on_hold IS dunning exhausted,
 *                 i.e. the real lapse, so "cancelled" is the honest landing)
 *   paused     -> subscription.paused (engine status "paused")
 *   cancelled  -> subscription.cancelled
 */
export const ENGINE_REVOKE_EVENT_FOR_STATUS: Readonly<Record<string, string>> = Object.freeze({
  refunded: "refund.succeeded",
  chargeback: "chargeback",
  on_hold: "dunning.exhausted",
  paused: "subscription.paused",
  cancelled: "subscription.cancelled",
});

/**
 * Restores go over the wire as ONE generic name.
 *
 * Every restore row means exactly the same thing to the engine — status back to
 * "active" — so the only thing a specific name would buy is a prettier
 * billing_reason column, and the price would be a second copy of the engine's
 * vocabulary living in this repo, ready to 400 the day the two drift. Our own
 * logs and the record's disputeStatus still carry which event it was.
 * entitlement.restored is in the engine's RESTORE_EVENTS and cannot be unknown
 * to it.
 */
export const ENGINE_RESTORE_EVENT = "entitlement.restored";

/**
 * The engine's TIER-SHAPED verb: updates which tier the customer is on and
 * never touches the access gate, so it cannot re-open a cancelled record -
 * which is exactly why reprice could not be pushed with a restore-shaped
 * event before this verb existed (finding 1c: a paid upgrade never reached
 * the engine until the reconciliation sweep, which is not scheduled).
 */
export const ENGINE_REPRICE_EVENT = "entitlement.repriced";

/** A row of DODO_EVENT_EFFECTS, as much of it as this module reads. */
export type DodoEffectLike = { kind?: string; status?: string } | null | undefined;

/**
 * The engine event for one effect-table row, or null when this event is not an
 * access change at all.
 *
 * `flag`, `log`, `reprice` and `activate` all return null, deliberately:
 *   - flag/log change nothing the customer can feel, so there is nothing to push.
 *   - reprice changes the TIER, and this endpoint's vocabulary is status-shaped;
 *     a restore-shaped push carrying a new plan would work but would also
 *     re-open access on a record whose status we were not asked to touch. Plan
 *     changes converge through the reconciliation sweep instead, which reads
 *     the plan straight off the web record.
 *   - activate is not on this path (the route handles it via activateDodo), and
 *     at first activation there is usually no bound engine tenant to push to
 *     yet — entitlement is granted at bind time.
 */
export function engineEventForEffect(effect: DodoEffectLike): string | null {
  if (!effect || typeof effect !== "object") return null;
  if (effect.kind === "revoke") {
    const status = typeof effect.status === "string" ? effect.status : "";
    return ENGINE_REVOKE_EVENT_FOR_STATUS[status] ?? null;
  }
  if (effect.kind === "restore") return ENGINE_RESTORE_EVENT;
  if (effect.kind === "reprice") return ENGINE_REPRICE_EVENT;
  return null;
}

/**
 * THE PROVIDER'S EMISSION TIME, as an ISO-8601 string. Never our own clock.
 *
 * Two sources, both from the provider, in order of directness:
 *   1. the event envelope's top-level `timestamp`, when Dodo sends one;
 *   2. the `webhook-timestamp` header — Standard Webhooks, in UNIX SECONDS, and
 *      guaranteed present on any request that got this far, because the
 *      signature is computed over id.timestamp.rawBody and would not verify
 *      without it.
 *
 * ISO STRING, NOT A NUMBER, AND THIS IS LOAD-BEARING. The engine parses a
 * numeric eventAt as MILLISECONDS (packages/state/src/tenant.mjs
 * applyBillingState). Handing it the header's SECONDS as a number would date
 * every push to 1970, and the ordering guard would then reject the very next
 * genuine event as "older than applied" — a revocation that reports 200 and
 * changes nothing, forever. Normalising here is the fix, and the number branch
 * below only guesses seconds-vs-millis for values that cannot plausibly be
 * milliseconds.
 *
 * Returns undefined only when NOTHING parsed. The engine then stamps its own
 * clock, which is worse (a "now" stamp can make a genuinely newer event look
 * stale) but is still convergent via the sweep — so undefined is a last resort,
 * not a shrug.
 */
export function engineEventAtIso(
  envelopeTimestamp: unknown,
  headerTimestamp?: string | null,
): string | undefined {
  const fromValue = (v: unknown): string | undefined => {
    if (typeof v === "string" && v.trim()) {
      const parsed = Date.parse(v.trim());
      if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
      // A bare numeric string ("1787329203") is a unix stamp, not a date string.
      const n = Number(v.trim());
      if (Number.isFinite(n) && n > 0) return fromValue(n);
      return undefined;
    }
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      // Anything below ~1e12 cannot be a millisecond stamp for a date in this
      // century, so it is seconds.
      const ms = v < 1e12 ? v * 1000 : v;
      const d = new Date(ms);
      return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
    }
    return undefined;
  };
  return fromValue(envelopeTimestamp) ?? fromValue(headerTimestamp);
}

/** What the caller hands us. Exactly the endpoint's body, plus a log label. */
export type EnginePushInput = {
  /** Engine tenant id, when the caller has one. The web currently never does. */
  tenantId?: string;
  /** The identifier the web actually holds for a bound customer. */
  telegramId?: number;
  /** An engine-vocabulary event — build it with engineEventForEffect(). */
  event: string;
  /** Restores only: the plan to restore the tier from, so restoration is exact. */
  plan?: string;
  /** Provider event id (the Standard-Webhooks webhook-id), for convergence. */
  eventId?: string;
  /** Provider emission time, ISO-8601. See engineEventAtIso(). */
  eventAt?: string;
  /** Free-text label for logs only, e.g. the Dodo event type. Never sent. */
  context?: string;
};

export type EnginePushResult = {
  /** True only if the engine ACCEPTED the push (HTTP 2xx). */
  pushed: boolean;
  /** Machine-readable outcome, for tests and log greps. */
  reason:
    | "ok"
    | "disabled_no_secret"
    | "no_identity"
    | "no_event"
    | "http_error"
    | "unreachable"
    | "timeout";
  status?: number;
};

/**
 * Why the push layer is off, or null if it is on.
 *
 * Exported so a caller can decide to skip work before assembling a payload, and
 * so a test can assert the disabled path without any network at all.
 */
export function pushDisabledReason(): string | null {
  return process.env.MIRA_BILLING_PUSH_SECRET ? null : "MIRA_BILLING_PUSH_SECRET is not set";
}

/** The full endpoint URL, honouring an operator override. */
export function enginePushUrl(): string {
  const base = (process.env.MIRA_ENGINE_URL || DEFAULT_ENGINE_BASE_URL).replace(/\/+$/, "");
  // Tolerate an operator who pasted the whole endpoint into the base var, rather
  // than doubling the path onto it and 404ing at 3am.
  return base.endsWith(ENGINE_PUSH_PATH) ? base : base + ENGINE_PUSH_PATH;
}

// Throttle for the "push layer is disabled" line: LOUD the first time it
// happens in a process, then at most once a minute. Mirrors the engine's own
// _lastNoSecretLog. Silence is what created gotchas#262 in the first place, so
// this is throttled, never suppressed.
let lastDisabledLog = 0;

/**
 * Push one entitlement change to the engine.
 *
 * NEVER THROWS. NEVER REJECTS. A throw out of here reaches the webhook handler,
 * becomes a 500, and becomes a Dodo redelivery loop aimed at a customer who is
 * already having a bad week. Every failure — unset secret, no identity,
 * connection refused, timeout, 401, 404, 500 — comes back as a value.
 *
 * The failure log deliberately states the consequence, not just the error: a
 * person reading it at 3am needs to know that access still converges through
 * the engine's per-message re-resolve and the reconciliation sweep, and that
 * they are looking at a delay, not at a customer who kept a refunded
 * subscription.
 */
export async function pushEntitlementToEngine(
  input: EnginePushInput,
  deps: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<EnginePushResult> {
  const label = input.context ? input.context + " -> " + input.event : input.event;

  if (!input.event) {
    console.error("[engine-push] refusing to push with no event name (" + (input.context ?? "no context") + ").");
    return { pushed: false, reason: "no_event" };
  }
  if (input.tenantId == null && input.telegramId == null) {
    // The caller is supposed to have skipped already; this is the backstop that
    // guarantees a fabricated identifier can never be invented down here.
    console.error("[engine-push] " + label + ": no tenantId and no telegramId — NOT pushing.");
    return { pushed: false, reason: "no_identity" };
  }

  const disabled = pushDisabledReason();
  if (disabled) {
    const now = Date.now();
    if (now - lastDisabledLog >= 60_000) {
      lastDisabledLog = now;
      console.error(
        "[engine-push] PUSH LAYER DISABLED: " + disabled + ". Entitlement changes (this one: " + label +
          ") are NOT being pushed to the engine, and the engine would reject them with 401 anyway. " +
          "Access still converges through the engine's per-message re-resolve and its reconciliation " +
          "sweep, so this is SLOWER revocation, not absent revocation. To enable immediate " +
          "revocation set MIRA_BILLING_PUSH_SECRET to the SAME value on this app and on the engine.",
      );
    }
    return { pushed: false, reason: "disabled_no_secret" };
  }

  const body: Record<string, unknown> = { event: input.event };
  if (input.tenantId != null) body.tenantId = input.tenantId;
  if (input.telegramId != null) body.telegramId = input.telegramId;
  if (input.plan) body.plan = input.plan;
  if (input.eventId) body.eventId = input.eventId;
  if (input.eventAt) body.eventAt = input.eventAt;

  const url = enginePushUrl();
  const doFetch = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? ENGINE_PUSH_TIMEOUT_MS;

  // AbortController rather than AbortSignal.timeout so the deadline is explicit
  // and the timer is always cleared — a webhook process should not accumulate
  // one pending timer per payment event.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        // The secret travels in a header and NOWHERE else: never in the URL,
        // never in a log line, never echoed into a response.
        Authorization: "Bearer " + process.env.MIRA_BILLING_PUSH_SECRET,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(
        "[engine-push] " + label + ": engine answered " + res.status + ". The entitlement change was " +
          "NOT applied immediately. It WILL still take effect through the engine's re-resolve and " +
          "reconciliation sweep — expect a delay, not a lost revocation. " +
          (res.status === 401
            ? "401 means the two sides hold different MIRA_BILLING_PUSH_SECRET values."
            : res.status === 404
              ? "404 means the engine holds no tenant for this identity (never bound, or bound elsewhere)."
              : ""),
      );
      return { pushed: false, reason: "http_error", status: res.status };
    }
    return { pushed: true, reason: "ok", status: res.status };
  } catch (err) {
    const aborted = controller.signal.aborted;
    console.error(
      "[engine-push] " + label + ": " +
        (aborted ? "no answer within " + timeoutMs + "ms" : "could not reach the engine") +
        " at " + url + ". The entitlement change was NOT applied immediately. It WILL still take " +
        "effect through the engine's per-message re-resolve and reconciliation sweep, so this is a " +
        "DELAY, not a customer keeping access they no longer paid for. If this repeats, check that " +
        "the engine is up and that MIRA_ENGINE_URL points at a port that reaches it (the endpoint " +
        "is loopback-bound on the engine host; from this host it is reached over the wa-tunnel " +
        "forward). Detail: " + (err instanceof Error ? err.message : String(err)),
    );
    return { pushed: false, reason: aborted ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
