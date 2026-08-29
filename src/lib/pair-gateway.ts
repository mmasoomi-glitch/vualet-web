/**
 * THE SERVER-TO-SERVER CALL THAT OPENS A WHATSAPP PAIRING SESSION.
 *
 * This module is the ONLY thing in this repo that speaks to the WhatsApp
 * gateway's provisioning endpoint. It exists as its own file, separate from the
 * route that calls it, so that the two questions it answers can be tested apart
 * from HTTP handling:
 *
 *   1. What exactly do we send the gateway, and with what secret?
 *   2. Is the link it sent back safe to redirect a customer to?
 *
 * ── WHY THE ENTRY POINT IS HERE AND NOT ON THE GATEWAY [decisions#345] ──────
 * The token is minted by THIS app and only this app can verify it (the HMAC key
 * is MIRA_TOKEN_SECRET, which the engine does not hold and must not). This app
 * is already Cloudflare-proxied with a working real_ip, so it is the only side
 * that knows the customer's genuine address. And it can reach the gateway
 * server-to-server over the existing tunnel. Only the QR PAGE itself needs to
 * reach the customer's browser, and that is nginx's job (docs/nginx-pair-proxy.conf).
 *
 * ── THE CONTRACT (RECONCILED with the engine side, 2026-08-21) ────────────
 *
 *     POST {MIRA_ENGINE_URL}/pair/request
 *     Authorization: Bearer <WA_PROVISION_SECRET>
 *     Content-Type: application/json
 *     X-Mira-Client-IP: <one client address, or the header is ABSENT>
 *     {
 *       "connectToken":    "<44-char connect token>",   // required
 *       "signupPhoneHash": "<64 hex chars>",            // optional, Q_B advisory
 *       "plan":            "<plan id>",                 // optional
 *       "expiresAt":       "<ISO-8601>"                 // optional, a CEILING
 *     }
 *
 *     200 -> { "sessionId": "<opaque>",
 *              "link":      "/pair/<sessionId>#<pairKey>",
 *              "resumed":   <boolean> }
 *
 *     400 invalid_connect_token   the token failed the engine's SHAPE check
 *     401 unauthorized            the two sides hold different secrets
 *     403 subscription_inactive   a revoked customer (gotchas#262)
 *     409 token_already_used      THE SINGLE-USE RULE FIRING [Q_C]
 *     410 token_expired           the engine's own token TTL aged it out
 *     429 rate_limited            the engine's token/IP limiter
 *
 * Every one of these is a REAL, EXPECTED answer. An earlier revision of this
 * module treated any 400 as "the two sides are on different contracts" and said
 * so in the log; that was right when the gateway still demanded a tenantId and
 * is wrong now, because 400 has a specific meaning. Only a 400 whose body is
 * NOT `invalid_connect_token` still means the contracts disagree.
 *
 * ── `resumed`, AND WHY IT IS LOGGED RATHER THAN SHOWN ─────────────────────
 * True means the customer came back to a pairing that already existed and got
 * THE SAME QR — the returning-customer case Q_C exists to protect. It is
 * deliberately NOT turned into customer-facing copy here: the pairing page is
 * the gateway's, it already knows it resumed a session, and re-deriving that
 * fact on this side would make two services the authority on one thing. What it
 * IS good for is operational truth, so it goes in the log line beside the
 * session id — it is the only way to see from production that resumability
 * works at all rather than merely being implemented.
 *
 * ── THE PROPERTIES THIS MODULE DEPENDS ON, and who guarantees them ────────
 *
 *   NO tenantId IS SENT, AND NONE IS EXPECTED BACK [decisions#345 Q_A]. A
 *   presented token must not create a tenant. Tenant creation is deferred until
 *   a scan proves control of the WhatsApp account. VERIFIED on the engine side:
 *   the connect-token branch sets `s.tenantId = null` explicitly, and migration
 *   014 alters only whatsapp_sessions/whatsapp_bindings.
 *
 *   IT IS IDEMPOTENT PER CONNECT TOKEN [decisions#345 Q_C]. A customer who
 *   abandons and comes back inside the TTL reopens THE SAME QR. This module
 *   deliberately caches NOTHING (see below), so the gateway is the only place
 *   that idempotency can live, and it now does: a resumable pairing returns the
 *   same session and pair key, or re-arms the same durable row onto a fresh
 *   session id after a restart.
 *
 *   IT READS X-Mira-Client-IP AS ONE VALUE [decisions#345 Q_D, gotchas#252].
 *   Over the tunnel the gateway's TCP peer is always 127.0.0.1, so it cannot see
 *   the customer. We hand it the address we CAN see. The header is single-valued
 *   by construction and must never be split on "," — and it must never be
 *   confused with `x-forwarded-for`, which is caller-appendable.
 *
 *   `expiresAt` IS A CEILING, NEVER AN EXTENSION. The engine takes the MINIMUM
 *   of its own TTL and whatever we assert (connectExpiry, wa-connect-pairing.mjs),
 *   so a caller cannot buy a longer life by claiming one. That is precisely why
 *   it is safe to send, and why we send a CONSERVATIVE value — see pairRequestBody.
 *
 *   IT STAYS FAIL-CLOSED. An unset WA_PROVISION_SECRET yields 401 for every
 *   caller. That is correct and this module treats it as a refusal to pass on,
 *   never as something to work around.
 *
 * ── WHAT THIS MODULE NEVER DOES ───────────────────────────────────────────
 * It never logs the connect token, the pair key, the returned link, or the
 * provisioning secret. The pair key travels in a URL FRAGMENT precisely so that
 * it stays in the customer's browser and reaches no server's logs; a single
 * console.log of `link` would undo that property for good, so the link is
 * carried as an opaque value and only ever described by shape.
 */

import { clientAddress, describeBadAddress, type ClientAddress } from "@/lib/client-address";

/** The provisioning endpoint path. Fixed by the gateway; never configurable. */
export const PAIR_REQUEST_PATH = "/pair/request";

/**
 * Where the gateway listens, from this host.
 *
 * DEFAULT IS LOOPBACK BECAUSE THE GATEWAY IS LOOPBACK-BOUND: it binds
 * 127.0.0.1:8790 only (jury C4). From the web host that address reaches the
 * engine ONLY through the wa-tunnel forward (permitopen 127.0.0.1:8790). The
 * name and default are deliberately the SAME ones src/lib/engine-push.ts
 * already uses — one tunnel, one variable. If the forward's local port is not
 * 8790, set MIRA_ENGINE_URL to the one it actually is.
 */
export const DEFAULT_ENGINE_BASE_URL = "http://127.0.0.1:8790";

/**
 * The secret the gateway checks. Held ONLY on the server, only in this
 * variable, and only ever placed in an Authorization header.
 *
 * It is the SAME value as the gateway's own WA_PROVISION_SECRET — the two sides
 * must hold the identical string or every call is 401.
 */
export const PROVISION_SECRET_ENV = "WA_PROVISION_SECRET";

/**
 * The header that carries the customer's real address to the gateway.
 *
 * A NEW NAME, ON PURPOSE. `x-forwarded-for` was rejected: it is the header
 * every proxy appends to, so a value arriving in it is a chain whose left end
 * the caller types (gotchas#247), and the gateway's existing helper splits it
 * on "," and takes the first hop. Handing it a value in that header would be
 * writing a trustworthy address into an untrustworthy slot. This header is
 * defined as SINGLE-VALUED: exactly one address or nothing at all.
 *
 * WHEN THE HEADER IS ABSENT IT MEANS "WE DO NOT KNOW", not "0.0.0.0" and not
 * "127.0.0.1". A placeholder would be a lie the gateway would bucket on.
 */
export const CLIENT_IP_FORWARD_HEADER = "x-mira-client-ip";

/**
 * A short, explicit deadline. The customer is sitting in front of a redirect
 * that has not happened yet, so a hung socket is a blank tab. Eight seconds is
 * long enough for a tunnel hop plus a Baileys socket coming up, and short
 * enough that the honest failure page still arrives while they are watching.
 */
export const PAIR_REQUEST_TIMEOUT_MS = 8000;

/** The full provisioning URL, honouring an operator override. */
export function pairRequestUrl(): string {
  const base = (process.env.MIRA_ENGINE_URL || DEFAULT_ENGINE_BASE_URL).replace(/\/+$/, "");
  // Tolerate an operator who pasted the whole endpoint into the base var rather
  // than doubling the path onto it and 404ing at 3am.
  return base.endsWith(PAIR_REQUEST_PATH) ? base : base + PAIR_REQUEST_PATH;
}

/** Why the pairing call cannot be made at all, or null when it can. */
export function pairDisabledReason(): string | null {
  return (process.env[PROVISION_SECRET_ENV] ?? "").trim()
    ? null
    : `${PROVISION_SECRET_ENV} is not set`;
}

/**
 * Our public origin, used ONLY to recognise an absolute link the gateway may
 * send as its own idea of the public base (its WA_PUBLIC_BASE is set to
 * https://mira.vualet.com). Same default as src/lib/dodo.ts so the app has one
 * answer to "where do we live".
 */
export function publicOrigin(): string {
  const raw = (process.env.MIRA_WEB_URL || "https://mira.vualet.com").trim();
  try {
    return new URL(raw).origin;
  } catch {
    return "https://mira.vualet.com";
  }
}

/**
 * THE OPEN-REDIRECT GUARD.
 *
 * The gateway is trusted to be honest, but "trusted" is not "unvalidated": this
 * value becomes a Location header pointed at a customer's browser, and a
 * compromised, misconfigured or simply upgraded gateway that returned
 * `https://evil.example/` would turn our signup link into an open redirect for
 * everyone. So the link is checked against a whitelist shape and anything else
 * is refused outright — the customer gets the honest failure page rather than a
 * redirect somewhere we did not vet.
 *
 * ACCEPTED, and nothing else:
 *   /pair/<segment>[#<fragment>]                     (what the gateway sends today)
 *   {publicOrigin}/pair/<segment>[#<fragment>]       (if it ever sends absolute)
 *
 * RETURNED AS A RELATIVE PATH, ALWAYS. A relative Location is resolved by the
 * browser against the URL it is already on — which is our public origin, behind
 * Cloudflare, because that is where the customer had to be to reach this route.
 * That makes "the customer never touches the engine host directly" true BY
 * CONSTRUCTION rather than by remembering to configure it.
 *
 * REJECTED, each for a specific reason:
 *   "//evil.example/x"   protocol-relative: a browser reads this as another ORIGIN.
 *   "/\\evil.example"    backslashes: browsers normalise "\" to "/", so "/\\x" is
 *                        another spelling of "//x".
 *   "https://evil/pair/" a different origin, however well-formed.
 *   "/pair/a/b"          more than one path segment: the QR page is /pair/<sid>.
 *   anything with a control character, a space, or a second "#".
 */
export function safePairPath(link: unknown): string | null {
  if (typeof link !== "string") return null;
  const raw = link.trim();
  if (raw === "" || raw.length > 512) return null;
  // Control characters and whitespace can smuggle a header break or a second
  // URL past a naive parser. There is no legitimate one in this value.
  if (/[ - ]/.test(raw)) return null;
  if (raw.includes("\\")) return null;

  let path = raw;
  if (!path.startsWith("/")) {
    // Absolute form: allowed only if it is OUR origin.
    let parsed: URL;
    try {
      parsed = new URL(path);
    } catch {
      return null;
    }
    if (parsed.origin !== publicOrigin()) return null;
    path = parsed.pathname + parsed.hash;
  }
  if (path.startsWith("//")) return null; // protocol-relative

  const hash = path.indexOf("#");
  const pathname = hash === -1 ? path : path.slice(0, hash);
  const fragment = hash === -1 ? "" : path.slice(hash + 1);

  // Exactly "/pair/<one segment>", with an optional trailing slash refused: a
  // second segment is not a page we proxy and not a page the gateway serves.
  const m = /^\/pair\/([A-Za-z0-9._~-]{1,128})$/.exec(pathname);
  if (!m) return null;

  // The fragment is the pair key. It is never inspected beyond its alphabet and
  // never logged; base64url plus the unreserved set covers what the gateway
  // emits without pinning this repo to the gateway's key length.
  if (fragment !== "" && !/^[A-Za-z0-9._~-]{1,512}$/.test(fragment)) return null;

  return fragment === "" ? pathname : `${pathname}#${fragment}`;
}

/** Everything the caller needs, and deliberately nothing the caller must not log. */
export type PairSessionResult =
  | {
      ok: true;
      /** A same-origin relative path, fragment INCLUDED. Redirect to it; never log it. */
      path: string;
      /** Safe to log: an opaque session id, not a secret and not an identity. */
      sessionId: string;
      /**
       * TRUE when the customer reopened a pairing that already existed [Q_C].
       *
       * `null` means the gateway did not say — an older build, or a field that
       * arrived as something other than a boolean. That is reported as UNKNOWN
       * rather than coerced to false, because "we were not told" and "we were
       * told no" are different facts and only one of them is evidence about
       * whether resumability is working.
       */
      resumed: boolean | null;
    }
  | {
      ok: false;
      /**
       * Machine-readable, for the route to pick a customer-facing message and
       * for tests to assert on. Never rendered to a customer verbatim.
       */
      reason:
        | "disabled_no_secret"
        | "unauthorized"
        | "inactive"
        | "rate_limited"
        /** 400 invalid_connect_token — the engine rejected the token's SHAPE. */
        | "invalid_token"
        /** 409 token_already_used — the single-use rule firing [Q_C]. */
        | "token_already_used"
        /** 410 token_expired — the engine's own token TTL aged it out. */
        | "token_expired"
        /** A 400 that is NOT invalid_connect_token: the two sides disagree. */
        | "contract_mismatch"
        | "bad_response"
        | "http_error"
        | "unreachable"
        | "timeout";
      status?: number;
    };

/** What we send the gateway, and the reasoning for each optional field. */
export type PairRequestInput = {
  /** The signup number's hash, or null. NULL MEANS SEND NOTHING — see below. */
  signupPhoneHash?: string | null;
  /** The plan on the connect record. Not PII; lets the engine set the tier at bind. */
  plan?: string | null;
  /** When OUR record dies. A ceiling the engine may only shorten, never extend. */
  expiresAt?: string | null;
};

/**
 * Build the request body.
 *
 * EVERY OPTIONAL FIELD IS OMITTED WHEN IT IS NOT KNOWN, never sent as null or
 * as an empty string. The engine reads each with a `typeof === 'string'` guard,
 * so a null would be ignored — but an empty string would not be, and for
 * `signupPhoneHash` in particular a wrong-shaped value is far worse than an
 * absent one: absent makes the advisory report "not comparable", which is true,
 * while a bad hash makes it report a MISMATCH about a real customer, which is a
 * lie that trains everyone to ignore the signal.
 */
export function pairRequestBody(
  connectToken: string,
  input: PairRequestInput = {},
): Record<string, string> {
  const body: Record<string, string> = { connectToken };
  // A 64-hex-char digest or nothing. The shape check is not paranoia about our
  // own code: it is the last place to catch a hash computed by a future edit
  // that no longer matches the engine's.
  if (input.signupPhoneHash && /^[0-9a-f]{64}$/.test(input.signupPhoneHash)) {
    body.signupPhoneHash = input.signupPhoneHash;
  }
  // The engine caps this at 64 chars; sending more would be silently truncated
  // into a plan id that means nothing, so it is capped here where it is visible.
  if (input.plan && input.plan.length <= 64) body.plan = input.plan;
  if (input.expiresAt) body.expiresAt = input.expiresAt;
  return body;
}

/**
 * The client-address header to send, or nothing.
 *
 * FAIL SILENT, NOT FAIL FAKE. When we have no trustworthy address the header is
 * OMITTED. The gateway then knows it does not know, which is a true statement it
 * can act on; a placeholder would be a false one it would bucket on, and every
 * addressless request would share that bucket — gotchas#252 rebuilt on the far
 * side of the tunnel.
 */
export function forwardedAddressHeaders(client: ClientAddress): Record<string, string> {
  return client.wire ? { [CLIENT_IP_FORWARD_HEADER]: client.wire } : {};
}

/**
 * Ask the gateway to open (or reopen) a pairing session for a connect token.
 *
 * NEVER THROWS. Every failure — unset secret, refused connection, timeout, 401,
 * 403, 429, a malformed body, a link that failed the guard — comes back as a
 * value, because the caller's job is to show a human an honest sentence and the
 * one thing it must never do is turn a gateway hiccup into a stack trace on a
 * customer's screen.
 *
 * IT WRITES NOTHING AND CONSUMES NOTHING. No record is mutated, no token is
 * claimed, no tenant is created. That is what makes the entry route safely
 * repeatable [decisions#345 Q_A, Q_C]: presenting a token is a READ.
 */
export async function requestPairSession(
  connectToken: string,
  req: Request,
  input: PairRequestInput = {},
  deps: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<PairSessionResult> {
  const disabled = pairDisabledReason();
  if (disabled) {
    console.error(
      `[pair-gateway] PAIRING DISABLED: ${disabled}. The gateway answers 401 to every caller ` +
        `without it, so no customer can link WhatsApp until this app and the gateway hold the ` +
        `SAME ${PROVISION_SECRET_ENV} value. Customers are being shown an honest "not available ` +
        `right now" page and nothing is being half-created.`,
    );
    return { ok: false, reason: "disabled_no_secret" };
  }

  const client = clientAddress(req);
  if (client.key === null) {
    // Not fatal — pairing still works, the gateway just cannot see who is
    // calling. But it means the edge needs looking at, so it is said out loud.
    console.error(
      `[pair-gateway] no usable ${"x-real-ip"}; the gateway will be told nothing about the ` +
        `client address for this request and its own per-IP limiter cannot bind. ` +
        `header=${describeBadAddress(client.reason, null)}` +
        (client.detail ? ` cloudflare_range=${client.detail}` : ""),
    );
  }

  const url = pairRequestUrl();
  const doFetch = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? PAIR_REQUEST_TIMEOUT_MS;

  // AbortController rather than AbortSignal.timeout so the deadline is explicit
  // and the timer is always cleared.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: {
        // The secret travels in a header and NOWHERE else: never in the URL,
        // never in a log line, never echoed into a response.
        Authorization: `Bearer ${process.env[PROVISION_SECRET_ENV]}`,
        "content-type": "application/json",
        ...forwardedAddressHeaders(client),
      },
      // NO tenantId. See Q_A above — a presented token must not create a tenant.
      body: JSON.stringify(pairRequestBody(connectToken, input)),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    const aborted = controller.signal.aborted;
    console.error(
      `[pair-gateway] ${aborted ? `no answer within ${timeoutMs}ms` : "could not reach the gateway"} ` +
        `at ${url}. No pairing session was opened and nothing was written, so the customer can ` +
        `simply follow their link again. If this repeats: the gateway is loopback-bound on the ` +
        `engine host and is reached from here ONLY through the wa-tunnel forward — check that ` +
        `wa-tunnel.service is running and that MIRA_ENGINE_URL names the port it forwards. ` +
        `Detail: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ok: false, reason: aborted ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // THE ERROR CODE IN THE BODY, NOT JUST THE STATUS. Two different faults
    // share status 400 — a token the engine considers malformed, and a gateway
    // that has not been switched off the old tenantId contract — and they need
    // opposite responses: one is a customer with a broken link, the other is an
    // operator with a deployment problem. The body is read defensively: it may
    // not be JSON, and a fault here must never become an exception.
    const code = await readErrorCode(res);

    if (res.status === 401) {
      console.error(
        `[pair-gateway] gateway answered 401. The two sides hold DIFFERENT ${PROVISION_SECRET_ENV} ` +
          `values (or the gateway's is unset). No customer can link WhatsApp until they match.`,
      );
      return { ok: false, reason: "unauthorized", status: 401 };
    }
    if (res.status === 403) {
      // The gateway refuses to stand up a session for a revoked customer
      // (gotchas#262). That is a real, customer-meaningful answer, not a fault.
      return { ok: false, reason: "inactive", status: 403 };
    }
    if (res.status === 429) {
      return { ok: false, reason: "rate_limited", status: 429 };
    }
    if (res.status === 409 || code === "token_already_used") {
      // THE SINGLE-USE RULE FIRING [Q_C]. Not an error on our side and not an
      // error on theirs: an account already bound with this token, and the
      // token died at that moment. It is logged at info level, without the
      // token, because it is expected behaviour rather than a fault.
      console.log(
        "[pair-gateway] gateway refused a token that has already been bound to a WhatsApp " +
          "account. This is the single-use rule working, not a failure.",
      );
      return { ok: false, reason: "token_already_used", status: res.status };
    }
    if (res.status === 410 || code === "token_expired") {
      // The engine keeps its OWN, shorter TTL than our 7-day record, so this is
      // genuinely reachable with a record that is still alive on this side.
      return { ok: false, reason: "token_expired", status: res.status };
    }
    if (res.status === 400 && code === "invalid_connect_token") {
      // Near-unreachable: we verify the HMAC before calling, and anything that
      // verifies also satisfies the engine's shape check. So this means the two
      // sides genuinely disagree about what a token looks like, and it is worth
      // a loud line even though the customer just sees "check your link".
      console.error(
        "[pair-gateway] gateway rejected the token's SHAPE although its HMAC verified here. " +
          "The two sides disagree about the connect-token format — compare mintConnectToken() " +
          "in src/lib/connect-token.ts with connectTokenShapeOk() in the engine.",
      );
      return { ok: false, reason: "invalid_token", status: 400 };
    }
    if (res.status === 400) {
      console.error(
        `[pair-gateway] gateway answered 400 with error=${code ?? "(none)"}. That is not ` +
          `invalid_connect_token, so the two sides are on DIFFERENT CONTRACTS — most likely a ` +
          `gateway that still REQUIRES a tenantId and has not been switched to accept a connect ` +
          `token. No pairing session was opened.`,
      );
      return { ok: false, reason: "contract_mismatch", status: 400 };
    }
    console.error(
      `[pair-gateway] gateway answered ${res.status} (error=${code ?? "(none)"}). ` +
        `No pairing session was opened.`,
    );
    return { ok: false, reason: "http_error", status: res.status };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    console.error("[pair-gateway] gateway answered 200 with a body that is not JSON.");
    return { ok: false, reason: "bad_response", status: res.status };
  }

  const obj = (body ?? {}) as { sessionId?: unknown; link?: unknown; resumed?: unknown };
  const path = safePairPath(obj.link);
  if (!path) {
    // DELIBERATELY DOES NOT PRINT THE LINK. It carries the pair key in its
    // fragment, and a rejected link is still a real key for a real session.
    console.error(
      "[pair-gateway] gateway answered 200 but its `link` did not pass the same-origin /pair/<id> " +
        "guard, so the customer was NOT redirected to it. The value is withheld from this log " +
        "because it carries the pair key. Check that the gateway still returns " +
        "`/pair/<sessionId>#<pairKey>`.",
    );
    return { ok: false, reason: "bad_response", status: res.status };
  }
  const sessionId = typeof obj.sessionId === "string" ? obj.sessionId : "";
  if (!sessionId) {
    console.error("[pair-gateway] gateway answered 200 with no sessionId.");
    return { ok: false, reason: "bad_response", status: res.status };
  }

  // UNKNOWN rather than false when the gateway did not send a boolean. Coercing
  // a missing field to `false` would quietly report "nobody ever resumes" from
  // a build that simply does not say, which is the one reading that would make
  // us stop trusting a working feature.
  const resumed = typeof obj.resumed === "boolean" ? obj.resumed : null;

  return { ok: true, path, sessionId, resumed };
}

/**
 * The `error` string from a non-2xx body, or null.
 *
 * BOUNDED AND TOTAL. The body is read as text with a hard cap and parsed inside
 * a try: a gateway having a bad day can return HTML, an empty body, or
 * megabytes of a stack trace, and none of those may become an exception on the
 * path whose entire job is to show a customer an honest sentence.
 */
async function readErrorCode(res: Response): Promise<string | null> {
  try {
    const text = (await res.text()).slice(0, 2048);
    const parsed: unknown = JSON.parse(text);
    const err = (parsed as { error?: unknown })?.error;
    return typeof err === "string" ? err : null;
  } catch {
    return null;
  }
}
