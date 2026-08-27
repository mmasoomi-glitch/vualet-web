import { getConnect } from "@/lib/store";
import { verifyConnectToken } from "@/lib/connect-token";
import { channelOfRecord } from "@/lib/pairing";
import { requestPairSession } from "@/lib/pair-gateway";
import { signupPhoneHash } from "@/lib/signup-phone-hash";
import { clientAddress, CLIENT_IP_HEADER, describeBadAddress } from "@/lib/client-address";


const NO_STORE_HEADERS: Readonly<{
  "cache-control": string;
  "referrer-policy": string;
  "x-robots-tag": string;
}> = Object.freeze({
  // Nothing on this path is ever cacheable: the request carries a token in
  // its query string and a cached answer would be shown to the wrong person.
  "cache-control": "no-store, no-cache, must-revalidate",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
});

/**
 * GET /api/pair/start?token=<connect token>
 *
 * THE PUBLIC ENTRY POINT FOR WHATSAPP PAIRING. This is the route that
 * MIRA_WHATSAPP_PAIR_BASE points at, and making it exist is what makes that
 * variable settable — which is what unblocks customer signup, because
 * /api/begin currently refuses with 503 whatsapp_unavailable rather than hand
 * out a link it cannot honour.
 *
 * ── WHY THE ENTRY POINT IS HERE AND NOT ON THE GATEWAY [decisions#345] ─────
 *   * THIS app minted the token and holds MIRA_TOKEN_SECRET, so this is the
 *     only side that can verify it. Pushing token verification into the engine
 *     would mean shipping the minting secret to a second machine.
 *   * THIS app sits behind Cloudflare with a working real_ip (verified live:
 *     origin logs record genuine client addresses), so it is the only side that
 *     can see who the customer is. The gateway's TCP peer, over the tunnel, is
 *     always 127.0.0.1.
 *   * THIS app can reach the gateway server-to-server over that tunnel.
 * Only the QR page itself has to reach the customer's browser, and nginx
 * proxies that (docs/nginx-pair-proxy.conf) — the customer never touches the
 * engine host directly.
 *
 * ── WHAT THIS ROUTE DOES, IN ORDER ────────────────────────────────────────
 *   1. Verify the token's HMAC. Cheap, no I/O, and it is what stops a flood of
 *      invented tokens from ever reaching the store or the buckets below.
 *   2. Rate-limit BY TOKEN, then BY IP [decisions#345 Q_D].
 *   3. Look the record up. A valid signature over an expired record is a real
 *      and ordinary case (7-day TTL) and gets its own honest answer.
 *   4. Take a slot against the global ceiling.
 *   5. Ask the gateway, server-to-server, for a pairing session.
 *   6. 302 the customer to /pair/<sid>#<pairKey>, same-origin.
 *
 * ── REPEATABILITY: WHAT A SECOND VISIT DOES, AND WHY [decisions#345 Q_C] ───
 * IT DOES THE SAME THING AGAIN. This route CONSUMES NOTHING and WRITES
 * NOTHING: presenting a token is a read. The token is claimed only on a
 * successful bind, by POST /api/pair/bind, which the engine calls after a scan
 * proves control of the account. So a customer who opens their link, wanders
 * off, and comes back an hour later gets sent to the pairing page again instead
 * of finding a dead token.
 *
 * The other half of "does not strand them" — reopening THE SAME QR rather than
 * minting a competing session — deliberately lives on the GATEWAY, not here.
 * The alternative was to cache the session locally, and that was rejected: the
 * link's fragment IS the pair key, so caching it would mean storing the one
 * secret whose entire design is that it never leaves the customer's browser.
 * We will not write that to our KV to save a round trip. The gateway therefore
 * owns idempotency-per-connect-token, and that is stated in the contract in
 * src/lib/pair-gateway.ts. If the gateway has NOT been made idempotent yet, the
 * degraded behaviour is safe rather than broken: the customer gets a fresh,
 * working QR and has to rescan. Never a dead end.
 *
 * What this route contributes to "no second competing session" is the
 * token-keyed rate limit below: a bounded number of provisions per token.
 *
 * ── WHAT THIS ROUTE MUST NOT CAUSE [decisions#345 Q_A] ────────────────────
 * NO TENANT IS CREATED because a token was presented. Nothing is sent to the
 * gateway that could name or imply a tenant, and nothing in the response is
 * read as one. Tenant creation is the engine's, deferred until a scan.
 *
 * ── WHAT IS NEVER LOGGED HERE ─────────────────────────────────────────────
 * The connect token, the pair key, the redirect target, the phone number, and
 * the provisioning secret. The pair key travels in a URL fragment exactly so it
 * reaches no server's logs; one console.log of the Location header would end
 * that property permanently. Session ids ARE logged: they are opaque, they are
 * not secrets, and they are the only thing that makes a support call tractable.
 */

// ── Rate limiting ─────────────────────────────────────────────────────────
// SAME SHAPE AS /api/begin's limiter (in-memory sliding window, per-instance,
// a per-caller gate plus a global ceiling that does not need to know the
// caller) because that shape has already been reasoned through and verified
// live. It is REBUILT here rather than imported for a plain reason: begin's
// `rateLimited`/`takeGlobalSlot`/`clientKey` are module-private AND hard-wired
// to begin's own counters and its own limit constants. Importing them would
// have meant sharing one bucket between two endpoints with different costs —
// a signup provisions a record, a pair-start opens a socket — so one endpoint
// under load would have throttled the other. The address handling, which is
// the part that was actually dangerous to get wrong, IS shared, in
// @/lib/client-address.
//
// Both maps are IN-MEMORY and PER-INSTANCE: they reset on restart or redeploy
// and are not shared between instances. Stated plainly rather than papered
// over.

/**
 * PER TOKEN — the stronger of the two gates, and the reason it is first.
 *
 * A token is unforgeable (HMAC) and it is exactly what this endpoint spends
 * gateway sessions on, so it is the honest unit of cost. Unlike an address it
 * is ALWAYS present and always trustworthy, so this gate can never fail open.
 *
 * TEN, not one. A customer legitimately reloads: the page did not appear, the
 * phone rang, they closed the tab and came back, they tried on the laptop and
 * then the desktop. A limit of one would turn Q_C's "must be able to return"
 * into a lie on the second click. Ten is generous for a human and still bounds
 * a single token to ten gateway sessions an hour.
 */
const TOKEN_LIMIT = 10;
const TOKEN_WINDOW_MS = 3_600_000; // 1 hour
const _tokenHits = new Map<string, number[]>();

/**
 * PER CLIENT ADDRESS — the second gate, and the one that can fail open.
 *
 * Twenty, i.e. two customers' worth, because a genuine shared address is
 * ordinary: an office, a household, a phone network's CGNAT. This gate exists
 * to stop one machine cycling through many tokens; the token gate already
 * handles one machine cycling on one token.
 */
const IP_LIMIT = 20;
const IP_WINDOW_MS = 3_600_000; // 1 hour
const _ipHits = new Map<string, number[]>();

function overLimit(
  map: Map<string, number[]>,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const arr = (map.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  map.set(key, arr);
  // Opportunistic cleanup so the map cannot grow unbounded.
  if (map.size > 5000) {
    for (const [k, v] of map) {
      if (v.every((t) => now - t >= windowMs)) map.delete(k);
    }
  }
  return arr.length > limit;
}

/**
 * THE GLOBAL CEILING — the only thing standing between "the edge stopped
 * giving us a client address" and unbounded gateway sessions.
 *
 * 240/hour: twice /api/begin's 120, because ONE honest signup legitimately
 * produces MORE than one pair-start (the customer reloads), while it takes a
 * whole signup to produce one /api/begin. It is far above any plausible real
 * hour — begin's own note puts the optimistic launch-day peak at 30-50 signups
 * an hour — and it bounds the bad day to 240 gateway sessions per instance per
 * hour instead of an open faucet.
 *
 * MIRA_PAIR_GLOBAL_LIMIT exists because the failure mode of this number being
 * wrong is a signup outage, and "wait for a code change and a redeploy" is not
 * an acceptable remedy for that. Absent or unparseable means the default, so a
 * typo in the environment cannot silently remove the ceiling.
 */
const GLOBAL_LIMIT_DEFAULT = 240;
const GLOBAL_WINDOW_MS = 3_600_000; // 1 hour
const GLOBAL_LIMIT_ENV = "MIRA_PAIR_GLOBAL_LIMIT";
let _globalHits: number[] = [];

function globalLimit(): number {
  const raw = process.env[GLOBAL_LIMIT_ENV];
  if (raw === undefined) return GLOBAL_LIMIT_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return GLOBAL_LIMIT_DEFAULT;
  return n;
}

/**
 * Reserve one gateway session against the ceiling, or refuse. Check and
 * increment in ONE synchronous step, taken immediately before the call, so two
 * in-flight requests cannot both pass and then both provision, and so a request
 * refused earlier never eats the budget a real customer needs.
 */
function takeGlobalSlot(): boolean {
  const now = Date.now();
  _globalHits = _globalHits.filter((t) => now - t < GLOBAL_WINDOW_MS);
  if (_globalHits.length >= globalLimit()) return false;
  _globalHits.push(now);
  return true;
}

// ── Throttled operational logging ─────────────────────────────────────────
// These events fire once per request under load, so logging every one would be
// its own denial of service. One line per slot per minute, carrying the count
// of everything it stands for.
const LOG_EVERY_MS = 60_000;
const _loggedAt = new Map<string, number>();
const _sinceLog = new Map<string, number>();

function logThrottled(slot: string, line: (occurrences: number) => string): void {
  const now = Date.now();
  const occurrences = (_sinceLog.get(slot) ?? 0) + 1;
  if (now - (_loggedAt.get(slot) ?? 0) < LOG_EVERY_MS) {
    _sinceLog.set(slot, occurrences);
    return;
  }
  _loggedAt.set(slot, now);
  _sinceLog.set(slot, 0);
  console.error(line(occurrences));
}

/**
 * HOW LONG A CONNECT RECORD LIVES, mirrored from store.ts's putConnect.
 *
 * FENCED DUPLICATION, exactly like the Cloudflare list in @/lib/client-address:
 * store.ts does not export this and is not this author's file to restructure,
 * so scripts/pair-entry-test.mjs asserts the two numbers agree against store.ts's
 * source. Edit one without the other and the suite goes red.
 */
const CONNECT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * When our record is guaranteed to be gone, as an ISO-8601 string, or null.
 *
 * A FLOOR, NOT THE EXACT EXPIRY, and that asymmetry is the point. Every
 * putConnect refreshes the store TTL, so the real expiry is 7 days from the LAST
 * write and this — 7 days from CREATION — can only ever be earlier. The engine
 * takes the MINIMUM of its own TTL and whatever we assert, so an under-estimate
 * can only shorten its window and never extend it. Under-estimating is
 * therefore the safe direction, and it preserves the property worth having: the
 * engine can never honour a token whose record we have already dropped.
 *
 * An unparseable createdAt returns null and the field is omitted, leaving the
 * engine on its own TTL. Guessing a date here would be asserting a lifetime we
 * cannot support.
 */
function connectRecordExpiry(createdAt: string | undefined): string | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return null;
  return new Date(t + CONNECT_TTL_SECONDS * 1000).toISOString();
}

// ── The honest failure page ───────────────────────────────────────────────
// The customer is in a BROWSER, following a link they were handed at signup, so
// a JSON error object would be a wall of nothing. They get a page.
//
// SAME PRINCIPLE THAT MADE /api/begin REFUSE RATHER THAN HAND OUT A DEAD LINK:
// say plainly that it did not work and what to do next, name no component, no
// status code, no secret and no token, and leave NO half-created state behind —
// there is none to leave, because nothing on this path writes.

/** Escape text for HTML. Every value below is ours, but a page that interpolates without escaping is one refactor from an injection. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A minimal, self-contained, accessible page. No external CSS, no fonts, no
 * script: this page must render when the rest of the world is on fire, which is
 * the only circumstance in which it is ever shown. `prefers-color-scheme` is
 * honoured so it is not a white flash in a dark browser, and the contrast on
 * both palettes clears WCAG 2.2 AA for body text.
 */
function failurePage(status: number, heading: string, body: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(heading)} — Mira</title>
<style>
  :root { color-scheme: light dark; --bg:#ffffff; --fg:#16181d; --muted:#4a4f5a; --line:#e3e5ea; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#101216; --fg:#f2f3f5; --muted:#b3b8c2; --line:#2a2e36; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
         display:flex; min-height:100vh; align-items:center; justify-content:center; padding:24px; }
  main { max-width:34rem; }
  h1 { font-size:1.5rem; line-height:1.3; margin:0 0 .75rem; }
  p { margin:0 0 1rem; color:var(--muted); }
  a { color:inherit; }
  .home { display:inline-block; margin-top:.5rem; padding:.6rem 1rem;
          border:1px solid var(--line); border-radius:.5rem; text-decoration:none; }
  .home:focus-visible { outline:3px solid currentColor; outline-offset:2px; }
</style>
</head>
<body>
<main>
  <h1>${esc(heading)}</h1>
  <p>${esc(body)}</p>
  <a class="home" href="/">Back to Mira</a>
</main>
</body>
</html>
`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...NO_STORE_HEADERS,
    },
  });
}

/**
 * "It is not you, it is us" — used for EVERY infrastructure fault: the secret
 * is unset, the tunnel is down, the gateway timed out, the gateway answered
 * something we could not use.
 *
 * ONE MESSAGE FOR ALL OF THEM, ON PURPOSE. The differences between those faults
 * are meaningful to us and meaningless to the customer, and spelling them out
 * would tell whoever is probing the endpoint which of our pieces is broken.
 * The distinction is in the log, where only we can read it.
 */
function unavailablePage(): Response {
  return failurePage(
    503,
    "WhatsApp linking isn't available right now",
    "Something on our side isn't responding, so we haven't started anything. Nothing has changed on your account. Please try your link again in a few minutes — it still works.",
  );
}

/**
 * "Start again." Used for BOTH expiries, and there are two of them: our own
 * 7-day connect-record TTL, and the engine's shorter token TTL. They are
 * genuinely different clocks and either can fire first, but the customer's
 * situation and remedy are identical, so they get one sentence rather than a
 * distinction they cannot act on.
 */
/**
 * "Your link is broken." Two callers reach it and both are right: a token whose
 * HMAC does not verify here, and a token the ENGINE rejects the shape of. From
 * the customer's chair those are the same situation with the same remedy, and
 * splitting them would only tell a prober which check they tripped.
 */
function badLinkPage(): Response {
  return failurePage(
    400,
    "This link doesn't look right",
    "It may have been cut short when it was copied. Please open the full link from your signup confirmation, or start again at mira.vualet.com.",
  );
}

function expiredPage(): Response {
  return failurePage(
    410,
    "This link has expired",
    "Signup links don't stay valid forever. Please start again at mira.vualet.com and we'll send you a fresh one.",
  );
}

/**
 * THE SINGLE-USE RULE, EXPLAINED TO THE PERSON IT JUST STOPPED [Q_C].
 *
 * This is the one refusal that is neither our fault nor a mistake on their
 * part, and it is the one most likely to be genuinely confusing — so it is the
 * one that must not hide behind a generic message. Two people can arrive here:
 * the customer who already connected and clicked their old link again, and
 * someone who got hold of a link that was not theirs. The wording has to serve
 * the first without confirming anything useful to the second, which is why it
 * describes the STATE ("already been used") and never the account.
 */
function alreadyUsedPage(): Response {
  return failurePage(
    409,
    "This link has already been used",
    "A WhatsApp account is already connected with it, and each link works only once. If that was you, you're all set — open WhatsApp and say hello to Mira. If it wasn't, get in touch and we'll help.",
  );
}

function tooManyPage(): Response {
  return failurePage(
    429,
    "Too many attempts",
    "You've opened this link several times in a short while. Please wait a few minutes and try again — your link is still valid.",
  );
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");

  // 1. THE SIGNATURE, FIRST. It costs no I/O, and it is what keeps invented
  //    tokens out of the store and out of the buckets below. Both the missing
  //    and the invalid case get the SAME answer: a caller must not be able to
  //    use this endpoint to learn whether a token is well-formed.
  if (!token || !verifyConnectToken(token)) return badLinkPage();

  // 2. THE TOKEN GATE [decisions#345 Q_D]. First, because it is the only key
  //    here that is always present and always trustworthy. The token is NOT
  //    used as the map key directly — a token is a bearer credential and this
  //    map is a plain object in a heap dump; its last 12 characters are ample
  //    to separate buckets and are useless to anyone who finds them.
  if (overLimit(_tokenHits, `t:${token.slice(-12)}`, TOKEN_LIMIT, TOKEN_WINDOW_MS)) {
    logThrottled(
      "token-limit",
      (n) =>
        `[pair-start] token rate limit hit: more than ${TOKEN_LIMIT} pairing starts for one token ` +
        `in ${TOKEN_WINDOW_MS}ms. occurrences_since_last_log=${n}`,
    );
    return tooManyPage();
  }

  // 3. THE ADDRESS GATE [decisions#345 Q_D]. FAIL OPEN when there is no
  //    trustworthy address (decisions#343): we do NOT key on a constant, we do
  //    NOT key on the socket address (always 127.0.0.1 behind our own nginx),
  //    and we do NOT fail closed, which would turn a logging gap into a signup
  //    outage. The token gate above and the ceiling below carry the request,
  //    and the fallback is logged, because it means the edge needs fixing.
  const client = clientAddress(req);
  if (client.key === null) {
    logThrottled(
      `no-client-address:${client.reason}`,
      (n) =>
        `[pair-start] no usable ${CLIENT_IP_HEADER} (${describeBadAddress(client.reason, req.headers.get(CLIENT_IP_HEADER))}` +
        (client.detail ? `, cloudflare_range=${client.detail}` : "") +
        `). Per-address limiting is OFF for these requests; the per-token gate and the global ` +
        `ceiling are holding them. occurrences_since_last_log=${n}`,
    );
  } else if (overLimit(_ipHits, client.key, IP_LIMIT, IP_WINDOW_MS)) {
    return tooManyPage();
  }

  // 4. THE RECORD. A valid signature over a record that is gone is ordinary,
  //    not suspicious: connect records carry a 7-day TTL. It gets its own
  //    honest answer rather than being folded into "this link doesn't look
  //    right", because the remedy is different — this customer must start over.
  const rec = await getConnect(token);
  if (!rec) return expiredPage();

  // A Telegram record must never be sent down the WhatsApp pairing path. This
  // should be unreachable — only WhatsApp signups are handed this URL — so it
  // is a contract check, and it is logged as one.
  if (channelOfRecord(rec) !== "whatsapp") {
    console.error(
      "[pair-start] a non-WhatsApp connect record reached the WhatsApp pairing entry point; " +
        "refusing. This means something built a pair URL for a Telegram signup.",
    );
    return failurePage(
      400,
      "This link is for a different way of chatting",
      "Your account is set up to talk to Mira on Telegram, not WhatsApp. Open the Telegram link from your signup confirmation instead.",
    );
  }

  // 5. THE CEILING. Taken HERE — after every refusal above and immediately
  //    before the call — so that refused requests cannot burn the budget real
  //    customers need.
  if (!takeGlobalSlot()) {
    logThrottled(
      "global-ceiling",
      (n) =>
        `[pair-start] GLOBAL CEILING REACHED: ${globalLimit()} pairing sessions in ` +
        `${GLOBAL_WINDOW_MS}ms; refusing further starts until the window rolls. Raise ` +
        `${GLOBAL_LIMIT_ENV} if this is real demand. refusals_since_last_log=${n}`,
    );
    return tooManyPage();
  }

  // 6. THE GATEWAY. Server-to-server, over the tunnel, with the bearer secret.
  //    Never throws; every fault comes back as a value.
  //
  // THREE OPTIONAL FIELDS TRAVEL WITH IT, and each one is a decision:
  //
  //   signupPhoneHash — [Q_B] ADVISORY ONLY. The engine can see which account
  //     scanned; we know which number was typed at signup; neither can compare
  //     them alone. A HASH crosses, never the number — same reasoning that made
  //     the stored WhatsApp id a hash. It is null for a record with no usable
  //     number, and null means SEND NOTHING: an absent hash makes the engine
  //     report "not comparable", which is true, while a wrong one would make it
  //     report a mismatch about a real customer, which is a lie. NOTHING HERE
  //     BRANCHES ON IT — a mismatch is a log line on the engine and no more.
  //
  //   plan — the tier the engine applies at bind. Not PII, already on the
  //     record, and sending it saves a round trip at the moment of binding.
  //
  //   expiresAt — a CEILING on the engine's own token TTL, never an extension:
  //     the engine takes the minimum of the two. It is derived from createdAt,
  //     so it is a floor on the record's real life (every write refreshes the
  //     store TTL) and therefore always conservative — it can only ever shorten
  //     the engine's window, which is the safe direction. What it buys is a
  //     guarantee that the engine can never honour a token our store has
  //     already dropped, even if its own TTL is raised past ours later.
  const session = await requestPairSession(token, req, {
    signupPhoneHash: signupPhoneHash(rec.phone),
    plan: rec.plan,
    expiresAt: connectRecordExpiry(rec.createdAt),
  });
  if (!session.ok) {
    if (session.reason === "rate_limited") return tooManyPage();
    if (session.reason === "token_already_used") return alreadyUsedPage();
    if (session.reason === "token_expired") {
      // The ENGINE's clock, not ours: our record is still here or we would not
      // have got this far. Same remedy, so the same page as our own expiry.
      return expiredPage();
    }
    if (session.reason === "invalid_token") {
      // The HMAC verified here but the engine rejected the shape. The customer
      // gets the same page as a mangled link, because from where they sit that
      // is exactly what it is; the real diagnosis is in the gateway client log.
      return badLinkPage();
    }
    if (session.reason === "inactive") {
      // The gateway refuses to stand up a session for a revoked customer
      // (gotchas#262). That is a real answer about THEIR account, so it gets a
      // true sentence rather than the generic "our side" one.
      return failurePage(
        403,
        "Your subscription isn't active",
        "We can't link WhatsApp while a subscription is inactive. Check your account page, or get in touch and we'll sort it out.",
      );
    }
    // contract_mismatch, unauthorized, unreachable, timeout, bad_response,
    // http_error — all of them are OUR problem, and all get one honest page.
    return unavailablePage();
  }

  // 7. THE REDIRECT.
  //
  // RELATIVE, ON PURPOSE. A relative Location is resolved by the browser
  // against the URL it is already on, which is our public origin behind
  // Cloudflare — so "the customer never touches the engine host" is true by
  // construction rather than by remembering to configure a base URL, and there
  // is no host value here for anyone to inject.
  //
  // THE FRAGMENT SURVIVES, AND THAT IS THE WHOLE POINT. A `#` in a Location
  // header is applied by the browser to the URL it lands on, and a fragment is
  // NEVER sent to a server in the request that follows. So the pair key reaches
  // the pairing page's JavaScript and reaches no access log, no proxy, and no
  // referrer — ours or anyone else's. Nothing below logs `session.path`.
  //
  // 302 AND NOT 301/308. A permanent redirect is cacheable, and what would be
  // cached is a URL carrying a live pair key — served later to whoever else
  // asks. `no-store` says the same thing again to any intermediary that ignores
  // status semantics.
  // `resumed` is logged and deliberately not shown to the customer: the pairing
  // page is the gateway's and already knows it resumed a session, so turning it
  // into copy here would make two services the authority on one fact. In the log
  // it is the only way to see from production that resumability actually works
  // rather than merely being implemented. "unknown" means the gateway did not
  // say, which is a different thing from "no" and is recorded as such.
  console.log(
    `[pair-start] pairing session opened session_id=${session.sessionId} ` +
      `resumed=${session.resumed === null ? "unknown" : session.resumed}`,
  );
  return new Response(null, {
    status: 302,
    headers: {
      location: session.path,
      ...NO_STORE_HEADERS,
    },
  });
}
