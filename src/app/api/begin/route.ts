import { NextResponse } from "next/server";
import { putConnect } from "@/lib/store";
import { mintConnectToken } from "@/lib/connect-token";
import { normalisePhone, phoneErrorText } from "@/lib/phone";
import {
  readConsent,
  CONSENT_MESSAGE_NO_PAYMENT,
  CONSENT_INVALID_MESSAGE,
  type StoredConsent,
} from "@/lib/consent";
import {
  CHANNELS,
  DEFAULT_SIGNUP_CHANNEL,
  whatsappPairUrl,
  type Channel,
} from "@/lib/pairing";

// Mock (no-payment) onboarding path. Creates a connect token that carries the
// persona chosen while shaping Mira, and returns the link that binds this setup
// to the customer's chat. Does NOT touch Stripe and works with zero env (store
// falls back to in-memory).
//
// Body: { plan?, email?, phone?, channel?, setup?: { assistantName?, role?, vibe?, persona? } }
//
// CHANNEL (decisions#340, option A): signup is WhatsApp-FIRST. `channel` is
// optional and DEFAULTS TO "whatsapp"; Telegram is still reachable, but only by
// asking for it explicitly, because it is no longer offered to new customers.
// It is not a feature flag — there is no "coming soon" branch here; either the
// pairing surface is configured and the customer gets a working link, or the
// call fails honestly (503) and nothing is provisioned.
//
// Length caps below are input-validation guards (OWASP ASVS 5.1/5.2), not
// business rules: they exist so a malicious/broken client can't shove
// megabytes of text into the store. `persona` is free-form user prose so it
// gets a generous cap; the short fields are effectively labels/enum-ish
// values and get a tight cap.
const CAP_SHORT = 200; // plan, email, phone, setup.assistantName/role/vibe
const CAP_PERSONA = 2000; // setup.persona

function tooLong(s: string | undefined, max: number): boolean {
  return typeof s === "string" && s.length > max;
}

// The WhatsApp pairing link is built by @/lib/pairing so that /api/begin and
// /api/connect can never drift apart; see PAIR_BASE_ENV there for the env var
// (MIRA_WHATSAPP_PAIR_BASE) and why this repo has no pairing route of its own.

// ── Rate limiting ─────────────────────────────────────────────────────────
// Every /api/begin call provisions a REAL tenant record and mints a REAL
// pairing token, so this endpoint is a resource faucet and has to be gated.
// There are TWO independent gates, because they defend different failures:
//
//   1. PER-CLIENT (RATE_LIMIT per RATE_WINDOW_MS) — stops one caller looping
//      the endpoint. It needs to know who the caller is.
//   2. GLOBAL PER-ENDPOINT CEILING (GLOBAL_LIMIT_DEFAULT per
//      GLOBAL_WINDOW_MS) — a hard cap on total provisions that does NOT depend
//      on knowing who the caller is. It is what carries the endpoint whenever
//      gate 1 cannot run (see clientKey / FAIL_OPEN below).
//
// Both are IN-MEMORY and PER-INSTANCE: they reset on restart or redeploy and
// are not shared between instances. Stated plainly rather than papered over —
// with N instances behind a load balancer the effective global ceiling is
// N × GLOBAL_LIMIT. Making them durable means putting a shared store on the
// request path, which is a real design change and is deliberately NOT smuggled
// in here.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 3_600_000; // 1 hour
const _hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (_hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  _hits.set(key, arr);
  // Opportunistic cleanup so the map can't grow unbounded.
  if (_hits.size > 5000) {
    for (const [k, v] of _hits) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) _hits.delete(k);
    }
  }
  return arr.length > RATE_LIMIT;
}

// ── The global per-endpoint ceiling ───────────────────────────────────────
// THE NUMBER, and why it is this number.
//
// This ceiling is the only thing between "the edge stopped giving us a client
// address" and "unlimited free tenant provisioning". So it has to be low
// enough to bound the damage and high enough that it never fires on real
// signups — a ceiling set too low is a self-inflicted signup outage on launch
// day, which is a worse outcome than the abuse it prevents.
//
// What legitimate traffic actually looks like for THIS product: Mira is
// pre-launch with no existing customer base, so today's genuine signup rate is
// approximately zero per hour. The optimistic launch-day case — a front-page
// post somewhere that actually converts — is on the order of a few hundred
// signups across the whole day, with a busiest hour somewhere around 30-50.
// 120/hour is roughly 3-4x that busiest plausible hour, so it should never
// bind on honest traffic; and because gate 1 allows only 5 per client, at
// least 24 DISTINCT clients must be signing up inside the same hour before
// this ceiling can be reached at all.
//
// What it bounds on the bad day: with the edge misconfigured AND someone
// abusing the endpoint, the worst case becomes 120 junk tenant records per
// hour per instance — bounded and cleanable — instead of an open faucet.
//
// MIRA_BEGIN_GLOBAL_LIMIT exists because the failure mode of this number being
// wrong is a signup outage, and "wait for a code change and a redeploy" is not
// an acceptable remedy for that on launch day. Absent or unparseable means the
// default, so a typo in the environment cannot silently remove the ceiling.
const GLOBAL_LIMIT_DEFAULT = 120;
const GLOBAL_WINDOW_MS = 3_600_000; // 1 hour
const GLOBAL_LIMIT_ENV = "MIRA_BEGIN_GLOBAL_LIMIT";
let _globalHits: number[] = [];

function globalLimit(): number {
  const raw = process.env[GLOBAL_LIMIT_ENV];
  if (raw === undefined) return GLOBAL_LIMIT_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return GLOBAL_LIMIT_DEFAULT;
  return n;
}

/**
 * Reserve one provision against the global ceiling, or refuse.
 *
 * Check-and-increment happen in ONE synchronous step, and the call site takes
 * the slot immediately before the write, so two in-flight requests cannot both
 * pass the check and then both provision. It counts PROVISIONS, not requests:
 * a refused or malformed request creates nothing, so it must not be able to
 * eat the budget that real customers need.
 */
function takeGlobalSlot(): boolean {
  const now = Date.now();
  _globalHits = _globalHits.filter((t) => now - t < GLOBAL_WINDOW_MS);
  if (_globalHits.length >= globalLimit()) return false;
  _globalHits.push(now);
  return true;
}

// ── Who is the caller? (gotchas#247, gotchas#252, decisions#343) ──────────
// The bucket key USED to be the leftmost hop of `x-forwarded-for`. That is a
// value the caller types: nginx uses `proxy_add_x_forwarded_for`, which
// APPENDS to whatever arrived instead of replacing it, so any caller could
// mint a fresh bucket per request and the limiter was decoration.
//
// The topology is: client -> Cloudflare edge -> nginx -> this app on
// 127.0.0.1. Two tempting repairs are both wrong, and both were rejected:
//   * "take the RIGHTMOST hop" — the rightmost hop is a Cloudflare edge IP, so
//     the whole internet collapses into ~12 shared buckets (gotchas#252).
//   * "fall back to the SOCKET address" — this app listens on 127.0.0.1 behind
//     an nginx on the SAME host, so the socket address is ALWAYS 127.0.0.1.
//     That is one global bucket: exactly the outage above, relabelled.
//
// So: read `x-real-ip` as ONE value and never split it on anything. nginx is
// configured (separately) with `set_real_ip_from` for every Cloudflare range
// plus `real_ip_header CF-Connecting-IP`, and emits a single trusted address
// here. Anything that is not a single valid IP address is treated as ABSENT,
// because a value we cannot parse is not a value we can trust as a key.
const CLIENT_IP_HEADER = "x-real-ip";

/** A dotted quad -> its four octets, or null if it is not one. */
function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) return null;
    // "01" is not a canonical octet and is octal to some parsers. Refusing it
    // means one address can never have two spellings, so never two buckets.
    if (part.length > 1 && part.startsWith("0")) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** An IPv6 literal -> its eight 16-bit groups, or null if it is not one. */
function parseIpv6(input: string): number[] | null {
  let value = input;
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  if (!value.includes(":")) return null;
  if (value.includes("%")) return null; // a zone id is never a public client

  // A trailing dotted quad (::ffff:203.0.113.9) is two more 16-bit groups.
  if (value.includes(".")) {
    const cut = value.lastIndexOf(":");
    const v4 = parseIpv4(value.slice(cut + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    value = `${value.slice(0, cut + 1)}${hi}:${lo}`;
  }

  const groupsOf = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const halves = value.split("::");
  if (halves.length > 2) return null;
  if (halves.length === 2) {
    const head = groupsOf(halves[0]);
    const tail = groupsOf(halves[1]);
    if (!head || !tail) return null;
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null; // "::" must stand for at least one group
    return [...head, ...new Array<number>(fill).fill(0), ...tail];
  }
  const all = groupsOf(value);
  if (!all || all.length !== 8) return null;
  return all;
}

/**
 * One IP address -> the bucket it belongs to, or null if the value is not a
 * single valid address.
 *   IPv4 -> /32, the address itself.
 *   IPv6 -> /64, the first four groups. A customer of any hosting provider is
 *           handed a whole /64 for pennies, so keying on all 128 bits would
 *           give an attacker effectively unlimited buckets.
 * There is deliberately NO comma handling anywhere in this file: a value with
 * a comma in it is a proxy chain, not an address, and a chain is precisely the
 * attacker-supplied thing this fix exists to stop trusting.
 */
type Address = { readonly v4: number[] } | { readonly v6: number[] };

/**
 * A header value -> the address it denotes, in canonical form, or null.
 *
 * ::ffff:a.b.c.d IS an IPv4 address wearing IPv6 clothes, and a dual-stack
 * listener can hand us either spelling for the same customer, so it is
 * normalised to IPv4 HERE, before anything else looks at it. Doing it later
 * would be a trap rather than a nicety: every IPv4-mapped address shares the
 * /64 "0:0:0:0", so EVERY IPv4 customer would collapse into ONE bucket, and a
 * Cloudflare edge address in mapped form would slip straight past the guard
 * below.
 *
 * There is deliberately NO comma handling anywhere in this file: a value with
 * a comma in it is a proxy chain, not an address, and a chain is precisely the
 * attacker-supplied thing this fix exists to stop trusting.
 */
function parseAddress(value: string): Address | null {
  const v4 = parseIpv4(value);
  if (v4) return { v4 };

  const v6 = parseIpv6(value);
  if (!v6) return null;

  const isV4Mapped =
    v6[0] === 0 && v6[1] === 0 && v6[2] === 0 && v6[3] === 0 && v6[4] === 0 && v6[5] === 0xffff;
  if (isV4Mapped) return { v4: [v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff] };

  return { v6 };
}

// ── The edge-address guard ────────────────────────────────────────────────
// THE FAILURE THIS EXISTS FOR, and why fail-open alone did not cover it.
//
// Fail-open only fires when `x-real-ip` is ABSENT. The dangerous state is the
// header being PRESENT AND WRONG: `real_ip_header CF-Connecting-IP` not (yet)
// configured, so nginx emits `$remote_addr` — which, behind Cloudflare, is a
// CLOUDFLARE EDGE IP. That value parses cleanly, masks cleanly and yields a
// confident non-null key, so the route would log nothing, degrade nothing and
// look perfectly healthy while silently enforcing gotchas#252's exact
// collapse: every user on earth funnelled into ~12 buckets of 5/hour.
// `x-real-ip $remote_addr` is a common nginx default, so this is a likely
// state, not an exotic one.
//
// The test for it is self-verifying, which is what makes it worth doing: IF
// `x-real-ip` HOLDS AN ADDRESS INSIDE A CLOUDFLARE RANGE, THAT IS PROOF THAT
// `real_ip` IS NOT CONFIGURED. A correctly configured nginx would already have
// replaced it with the true client address, and a genuine end user is never a
// Cloudflare edge IP. So such a value is treated as UNTRUSTED — handled
// identically to an absent header: null key, fail open, loud log. That turns a
// silent global outage into a noisy, safe degrade, and it means this route no
// longer silently depends on a host config it cannot see from here.
//
// STALENESS — the known limitation, stated so nobody trusts the list blindly.
// These ranges are VENDORED from Cloudflare's published lists
// (https://www.cloudflare.com/ips-v4 and /ips-v6), fetched once when this was
// written. They are deliberately NOT fetched at request time: an outbound call
// on the signup path would be a new failure mode and a new latency budget for
// no benefit. The cost of vendoring is drift. If Cloudflare ADDS a range that
// is not in this list, the guard does not recognise traffic arriving through
// it, and for that range only we are back to the silent collapse this guard
// exists to prevent — it fails quiet, not loud. Refresh the list whenever
// Cloudflare publishes a change.
//
// And note what this guard is and is not. It DETECTS a misconfigured edge; it
// does not repair one. The real fix is `set_real_ip_from` for every Cloudflare
// range plus `real_ip_header CF-Connecting-IP` on the host. Until that lands,
// this route runs fail-open on the global ceiling and says so once a minute.
const CLOUDFLARE_RANGES: readonly string[] = [
  // IPv4 — https://www.cloudflare.com/ips-v4
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  // IPv6 — https://www.cloudflare.com/ips-v6. Covering IPv6 is not optional:
  // the direct-to-origin exposure exists on both families, and a v4-only guard
  // would be a half guard that reports "healthy" for every v6 visitor.
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

type Cidr = { readonly cidr: string; readonly base: Address; readonly prefix: number };

/** The vendored list, parsed ONCE at module load rather than per request. */
const CLOUDFLARE_CIDRS: readonly Cidr[] = CLOUDFLARE_RANGES.map((cidr) => {
  const slash = cidr.lastIndexOf("/");
  const base = parseAddress(cidr.slice(0, slash));
  const prefix = Number(cidr.slice(slash + 1));
  return base && Number.isInteger(prefix) ? { cidr, base, prefix } : null;
}).filter((c): c is Cidr => c !== null);

/** Do the leading `prefix` bits of two same-width group arrays agree? */
function prefixMatches(a: number[], b: number[], groupBits: number, prefix: number): boolean {
  for (let i = 0; i < a.length; i++) {
    const used = Math.min(groupBits, Math.max(0, prefix - i * groupBits));
    if (used === 0) return true;
    const mask = ((1 << groupBits) - 1) ^ ((1 << (groupBits - used)) - 1);
    if ((a[i] & mask) !== (b[i] & mask)) return false;
  }
  return true;
}

/**
 * The Cloudflare range this address falls in, or null.
 *
 * A non-null answer is a fact about OUR EDGE, never about the customer — the
 * address belongs to Cloudflare — so it is safe to log, and it is the single
 * most useful thing to log when this fires.
 */
function cloudflareRange(addr: Address): string | null {
  for (const c of CLOUDFLARE_CIDRS) {
    if ("v4" in addr && "v4" in c.base && prefixMatches(addr.v4, c.base.v4, 8, c.prefix)) {
      return c.cidr;
    }
    if ("v6" in addr && "v6" in c.base && prefixMatches(addr.v6, c.base.v6, 16, c.prefix)) {
      return c.cidr;
    }
  }
  return null;
}

/**
 * The bucket for an address.
 *   IPv4 -> /32, the address itself.
 *   IPv6 -> /64, the first four groups. A customer of any hosting provider is
 *           handed a whole /64 for pennies, so keying on all 128 bits would
 *           give an attacker effectively unlimited buckets.
 */
function maskAddress(addr: Address): string {
  if ("v4" in addr) return `v4:${addr.v4.join(".")}`;
  return `v6:${addr.v6.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/** Why there is no trustworthy bucket for a caller. */
type NoKeyReason = "absent" | "unparseable" | "edge-address";

type ClientKey =
  | { key: string; reason?: undefined; detail?: undefined }
  | { key: null; reason: NoKeyReason; detail?: string };

/**
 * The caller's rate-limit bucket, or null plus the reason there isn't one.
 *
 * The reason is carried out rather than flattened away because the three cases
 * mean genuinely different things to whoever reads the log: "absent" and
 * "unparseable" say we were told nothing usable, while "edge-address" says we
 * were told something confidently WRONG, which is the more urgent diagnosis.
 */
function clientKey(req: Request): ClientKey {
  const raw = req.headers.get(CLIENT_IP_HEADER);
  if (raw === null) return { key: null, reason: "absent" };
  const value = raw.trim();
  if (value === "") return { key: null, reason: "absent" };

  const addr = parseAddress(value);
  if (!addr) return { key: null, reason: "unparseable" };

  const edge = cloudflareRange(addr);
  if (edge) return { key: null, reason: "edge-address", detail: edge };

  return { key: maskAddress(addr) };
}

// ── Throttled operational logging ─────────────────────────────────────────
// Both events below fire once per request under attack, so logging every one
// would be its own denial of service. One line per slot per minute, carrying
// the count of everything it stands for.
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
 * The FAIL_OPEN path fired: there is no trustworthy client address, so
 * per-client limiting is OFF for this request and only the global ceiling is
 * holding it. That means THE EDGE IS MISCONFIGURED and a human has to know.
 *
 * "edge-address" gets its OWN throttle slot and its own wording. It is a
 * different and more urgent fault than a missing header — the edge is
 * confidently telling us the wrong thing — and it must not be able to hide
 * behind, or be hidden by, a flood of the other kind.
 *
 * On the absent/unparseable path the raw value is DESCRIBED, never printed: it
 * may be a customer's address in a form we merely failed to parse, and a
 * shipped log is not a place for that. The two facts that actually diagnose
 * the fault — is it absent, and does it still contain a comma (i.e. nginx is
 * emitting a chain) — are safe to state. On the edge-address path the matched
 * CIDR is printed instead of the address: it is the whole diagnosis, and it is
 * provably not a customer's address.
 */
function noteNoClientAddress(reason: NoKeyReason, raw: string | null, detail?: string): void {
  if (reason === "edge-address") {
    logThrottled(
      "edge-address",
      (n) =>
        `[begin] EDGE MISCONFIGURED: ${CLIENT_IP_HEADER} holds a CLOUDFLARE address (${detail}), ` +
        `which is proof that set_real_ip_from / real_ip_header CF-Connecting-IP is NOT configured ` +
        `on this host — nginx is passing $remote_addr through. Refusing to key the rate limiter ` +
        `on it, because that would put every visitor on earth into ~12 shared buckets ` +
        `(gotchas#252). Per-client limiting is OFF and only the global ceiling is holding these ` +
        `requests. occurrences_since_last_log=${n}`,
    );
    return;
  }
  const shape =
    reason === "absent"
      ? "absent"
      : `unparseable(len=${raw === null ? 0 : raw.length},comma=${raw !== null && raw.includes(",")})`;
  logThrottled(
    "no-client-address",
    (n) =>
      `[begin] EDGE MISCONFIGURED: no usable ${CLIENT_IP_HEADER}; per-client rate limiting is ` +
      `OFF for these requests and only the global ceiling is holding them (fail-open, ` +
      `decisions#343). header=${shape} occurrences_since_last_log=${n}`,
  );
}

/**
 * The 429. DELIBERATELY IDENTICAL for both gates: a caller must not be able to
 * tell "you are limited" from "the endpoint is saturated", because the second
 * is a useful signal to whoever is doing the saturating. The distinction is
 * recorded in the log instead, where only we can read it.
 */
function rateLimitedResponse(): NextResponse {
  return NextResponse.json(
    { error: "rate_limited", message: "Too many requests. Try again later." },
    { status: 429 },
  );
}

export async function POST(req: Request) {
  // Gate 1 — per-client. Runs before the body is even parsed: a caller who is
  // already over their allowance is refused whatever they sent.
  //
  // FAIL_OPEN when there is no trustworthy client address (decisions#343). We
  // do NOT fall back to a constant bucket (the previous `|| "unknown"` was
  // exactly that, and it was a latent outage: every caller without the header
  // shared one 5-per-hour allowance), we do NOT fall back to the socket
  // address (always 127.0.0.1 here — the same outage), and we do NOT fail
  // closed (that turns a logging gap into a signup outage). The global ceiling
  // in gate 2 carries these requests instead, and the fallback is logged
  // loudly, because it means the edge needs fixing.
  //
  // "No trustworthy address" INCLUDES a header that is present and wrong: an
  // x-real-ip inside a Cloudflare range is proof the edge is not rewriting it
  // (see cloudflareRange above). That case is handled here identically to an
  // absent header, because keying on it would silently collapse every visitor
  // into a handful of shared buckets while the endpoint looked healthy.
  const client = clientKey(req);
  if (client.key === null) {
    noteNoClientAddress(client.reason, req.headers.get(CLIENT_IP_HEADER), client.detail);
  } else if (rateLimited(client.key)) {
    return rateLimitedResponse();
  }

  let body: {
    plan?: string;
    email?: string;
    phone?: string;
    channel?: string;
    consent?: unknown;
    setup?: { assistantName?: string; role?: string; vibe?: string; persona?: string };
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { plan, email, phone, channel: channelRaw, consent: consentRaw, setup } = body;

  if (
    tooLong(plan, CAP_SHORT) ||
    tooLong(email, CAP_SHORT) ||
    tooLong(phone, CAP_SHORT) ||
    tooLong(setup?.assistantName, CAP_SHORT) ||
    tooLong(setup?.role, CAP_SHORT) ||
    tooLong(setup?.vibe, CAP_SHORT) ||
    tooLong(setup?.persona, CAP_PERSONA)
  ) {
    return NextResponse.json({ error: "field too long" }, { status: 400 });
  }

  // Channel: absent means WhatsApp. An unrecognised value is a client bug and
  // is refused rather than silently coerced — a customer must never be quietly
  // put on a channel they did not ask for.
  if (channelRaw !== undefined && !CHANNELS.includes(channelRaw as Channel)) {
    return NextResponse.json(
      { error: "invalid_channel", message: "Choose WhatsApp or Telegram." },
      { status: 400 },
    );
  }
  const channel: Channel = (channelRaw as Channel | undefined) ?? DEFAULT_SIGNUP_CHANNEL;

  // Phone: REQUIRED for WhatsApp (it is the address we pair to), optional for
  // Telegram (which pairs on a Telegram id). Whenever one is supplied it must
  // normalise, and only the normalised E.164 is stored — never the raw input,
  // so "+971 50 123 4567" and "0501234567" cannot become two identities.
  //
  // No defaultCallingCode is passed: the one definition of the default country
  // lives in @/lib/phone (DEFAULT_CALLING_CODE) and normalisePhone already
  // applies it. Repeating it here would be a copy that could silently drift
  // from the lib, so the call site deliberately does not have an opinion.
  const phoneGiven = typeof phone === "string" && phone.trim().length > 0;
  let e164: string | undefined;
  if (channel === "whatsapp" || phoneGiven) {
    const result = normalisePhone(phone);
    if (!result.ok) {
      return NextResponse.json(
        { error: "invalid_phone", reason: result.reason, message: phoneErrorText(result.reason) },
        { status: 400 },
      );
    }
    e164 = result.e164;
  }

  // ── Consent (release gate C1, specs#160) ────────────────────────────────
  // The wizard renders the disclosure and posts what was ticked, but a gate that
  // is only enforced in the browser is a gate anyone can walk around: this route
  // previously ACCEPTED `consent` in the body and discarded it, so a trial
  // customer could end up with a bound WhatsApp number and no server-side record
  // that they were ever shown the ban-risk notice. It is checked here, and the
  // proof is stored on the record.
  //
  // The rule itself is @/lib/consent — the same module the disclosure component
  // and /api/checkout use — so the free path and the paid path cannot drift into
  // demanding different things. Required for WhatsApp ONLY: specs#160 is a
  // WhatsApp disclosure, and extracting WhatsApp ban-risk consent from a Telegram
  // customer would be theatre.
  let consent: StoredConsent | undefined;
  if (channel === "whatsapp") {
    const checked = readConsent(consentRaw);
    if (!checked.ok) {
      return NextResponse.json(
        {
          error: checked.error,
          missing: checked.missing,
          message:
            checked.error === "consent_invalid"
              ? CONSENT_INVALID_MESSAGE
              : CONSENT_MESSAGE_NO_PAYMENT,
        },
        { status: 400 },
      );
    }
    consent = checked.consent;
  }

  // Configuration is checked BEFORE anything is minted or persisted: a record
  // the customer can never pair against is worse than a clean refusal.
  let pairUrl: string | null = null;
  const token = mintConnectToken();
  if (channel === "whatsapp") {
    pairUrl = whatsappPairUrl(token);
    if (!pairUrl) {
      return NextResponse.json(
        {
          error: "whatsapp_unavailable",
          message: "WhatsApp signup isn't available right now. Please try again shortly.",
        },
        { status: 503 },
      );
    }
  }

  // Gate 2 — the global per-endpoint ceiling. Taken HERE, at the moment of
  // provisioning and after every refusal above, so that (a) rejected requests
  // cannot burn the budget real customers need, and (b) the reservation cannot
  // race the write that follows it.
  if (!takeGlobalSlot()) {
    logThrottled(
      "global-ceiling",
      (n) =>
        `[begin] GLOBAL CEILING REACHED: ${globalLimit()} provisions in ${GLOBAL_WINDOW_MS}ms; ` +
        `refusing further signups until the window rolls. Raise ${GLOBAL_LIMIT_ENV} if this is ` +
        `real demand. refusals_since_last_log=${n}`,
    );
    return rateLimitedResponse();
  }

  await putConnect({
    token,
    plan: plan ?? "trial",
    status: "pending",
    persona: setup?.persona,
    role: setup?.role,
    assistantName: setup?.assistantName,
    email,
    phone: e164,
    channel,
    consent,
    createdAt: new Date().toISOString(),
  });

  if (channel === "whatsapp") {
    return NextResponse.json({ token, channel, pairUrl });
  }

  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT || "ballerina_10840_bot";
  return NextResponse.json({
    token,
    channel,
    botUrl: `https://t.me/${bot}?start=${token}`,
  });
}
