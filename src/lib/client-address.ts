/**
 * THE REAL CLIENT ADDRESS — extracted so two routes cannot disagree about who
 * the caller is.
 *
 * PROVENANCE, STATED PLAINLY. Every rule below is a VERBATIM EXTRACTION of the
 * address handling that already ships inside src/app/api/begin/route.ts
 * (gotchas#247, gotchas#252, decisions#343). Nothing here is new policy and
 * nothing here is a "cleanup" of it — the reasoning that produced those rules
 * was paid for in a live vulnerability, so it is repeated in full rather than
 * summarised away: a summary is how the second copy starts drifting from the
 * first.
 *
 * WHY THERE IS A SECOND COPY AT ALL, AND WHAT GUARDS IT. /api/begin's copy is
 * module-private and hard-wired to /api/begin's own counters, so it cannot be
 * imported, and /api/begin is not this author's file to rewrite. Rather than
 * pretend the duplication is harmless, scripts/pair-entry-test.mjs asserts the
 * two halves against each other: the vendored Cloudflare CIDR list inside
 * begin/route.ts must be set-equal to the one below, and the two
 * implementations must agree on a table of addresses. Edit one without the
 * other and the suite goes red. The duplication is still debt; it is FENCED
 * debt. THE FIX IS TO POINT begin/route.ts AT THIS MODULE and delete its
 * private copy — a one-file change for whoever owns that route.
 *
 * WHAT THIS MODULE REFUSES TO DO, and why each refusal exists:
 *   * It never splits a header on ",". A value with a comma in it is a proxy
 *     CHAIN, not an address, and a chain is attacker-typed: nginx uses
 *     `proxy_add_x_forwarded_for`, which APPENDS to whatever arrived, so the
 *     leftmost hop is chosen by the person being limited (gotchas#247).
 *   * It never takes the RIGHTMOST hop. Behind Cloudflare that is an edge IP,
 *     which collapses the whole internet into ~12 buckets (gotchas#252).
 *   * It never falls back to the socket address. This app listens on 127.0.0.1
 *     behind an nginx on the SAME host, so the socket address is ALWAYS
 *     127.0.0.1 — one global bucket, i.e. gotchas#252 relabelled.
 *   * It never returns an address that is INSIDE a Cloudflare range. Such a
 *     value is self-verifying proof that `real_ip_header CF-Connecting-IP` is
 *     not configured, because a correctly configured nginx would already have
 *     replaced it and a genuine end user is never a Cloudflare edge IP.
 */

/**
 * The ONE header that carries a trustworthy client address here.
 *
 * nginx is configured (separately, on the host) with `set_real_ip_from` for
 * every Cloudflare range plus `real_ip_header CF-Connecting-IP`, and emits a
 * single trusted address in this header. Verified live: origin logs record real
 * client addresses, not Cloudflare edge IPs.
 */
export const CLIENT_IP_HEADER = "x-real-ip";

/** A dotted quad -> its four octets, or null if it is not one. */
export function parseIpv4(value: string): number[] | null {
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
export function parseIpv6(input: string): number[] | null {
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

export type Address = { readonly v4: number[] } | { readonly v6: number[] };

/**
 * A header value -> the address it denotes, in canonical form, or null.
 *
 * ::ffff:a.b.c.d IS an IPv4 address wearing IPv6 clothes, and a dual-stack
 * listener can hand us either spelling for the same customer, so it is
 * normalised to IPv4 HERE, before anything else looks at it. Doing it later
 * would be a trap rather than a nicety: every IPv4-mapped address shares the
 * /64 "0:0:0:0", so EVERY IPv4 customer would collapse into ONE bucket, and a
 * Cloudflare edge address in mapped form would slip straight past the guard.
 */
export function parseAddress(value: string): Address | null {
  const v4 = parseIpv4(value);
  if (v4) return { v4 };

  const v6 = parseIpv6(value);
  if (!v6) return null;

  const isV4Mapped =
    v6[0] === 0 && v6[1] === 0 && v6[2] === 0 && v6[3] === 0 && v6[4] === 0 && v6[5] === 0xffff;
  if (isV4Mapped) return { v4: [v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff] };

  return { v6 };
}

/**
 * The vendored Cloudflare ranges. KEPT SET-EQUAL to the list inside
 * src/app/api/begin/route.ts — scripts/pair-entry-test.mjs asserts that against
 * that file's source, so the two cannot drift apart silently.
 *
 * STALENESS is the known cost of vendoring: these are copied from
 * https://www.cloudflare.com/ips-v4 and /ips-v6 and are deliberately NOT
 * fetched at request time, because an outbound call on the signup path is a new
 * failure mode and a new latency budget for no benefit. If Cloudflare ADDS a
 * range that is not here, the guard does not recognise traffic arriving through
 * it — it fails QUIET, not loud. Refresh whenever Cloudflare publishes a change
 * (npm run check:cloudflare-ranges).
 */
export const CLOUDFLARE_RANGES: readonly string[] = [
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
export function cloudflareRange(addr: Address): string | null {
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
 * The rate-limit bucket for an address.
 *   IPv4 -> /32, the address itself.
 *   IPv6 -> /64, the first four groups. A customer of any hosting provider is
 *           handed a whole /64 for pennies, so keying on all 128 bits would
 *           give an attacker effectively unlimited buckets.
 */
export function maskAddress(addr: Address): string {
  if ("v4" in addr) return `v4:${addr.v4.join(".")}`;
  return `v6:${addr.v6.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/**
 * The address in canonical WIRE form — the exact string to hand another
 * service that needs to know who the caller is.
 *
 * THIS IS NOT maskAddress(), AND THE TWO MUST NEVER BE MERGED. A rate-limit
 * bucket is deliberately lossy (an IPv6 /64) and carries a namespace prefix; a
 * forwarded address must be the address. Sending a bucket key downstream would
 * hand another service a "/64" label as if it were a client, and masking a wire
 * value would widen a limiter — both silently.
 */
export function formatAddress(addr: Address): string {
  if ("v4" in addr) return addr.v4.join(".");
  return addr.v6.map((g) => g.toString(16)).join(":");
}

/** Why there is no trustworthy address for a caller. */
export type NoAddressReason = "absent" | "unparseable" | "edge-address";

export type ClientAddress =
  | { addr: Address; key: string; wire: string; reason?: undefined; detail?: undefined }
  | { addr: null; key: null; wire: null; reason: NoAddressReason; detail?: string };

/**
 * The caller's trusted address, or null plus the reason there isn't one.
 *
 * The reason is carried out rather than flattened away because the three cases
 * mean genuinely different things to whoever reads the log: "absent" and
 * "unparseable" say we were told nothing usable, while "edge-address" says we
 * were told something confidently WRONG, which is the more urgent diagnosis.
 *
 * A null answer is never repaired with a constant. Callers FAIL OPEN on
 * per-client limiting and lean on whatever ceiling does not need to know who
 * the caller is (decisions#343) — a shared "unknown" bucket is a signup outage
 * waiting for a header to go missing.
 */
export function clientAddress(req: Request): ClientAddress {
  const raw = req.headers.get(CLIENT_IP_HEADER);
  if (raw === null) return { addr: null, key: null, wire: null, reason: "absent" };
  const value = raw.trim();
  if (value === "") return { addr: null, key: null, wire: null, reason: "absent" };

  const addr = parseAddress(value);
  if (!addr) return { addr: null, key: null, wire: null, reason: "unparseable" };

  const edge = cloudflareRange(addr);
  if (edge) return { addr: null, key: null, wire: null, reason: "edge-address", detail: edge };

  return { addr, key: maskAddress(addr), wire: formatAddress(addr) };
}

/**
 * A safe DESCRIPTION of a header value we could not use, for logs.
 *
 * The raw value is DESCRIBED, never printed: it may be a customer's address in
 * a form we merely failed to parse, and a shipped log is not a place for that.
 * The two facts that actually diagnose the fault — is it absent, and does it
 * still contain a comma (i.e. nginx is emitting a chain) — are safe to state.
 */
export function describeBadAddress(reason: NoAddressReason, raw: string | null): string {
  if (reason === "absent") return "absent";
  if (reason === "edge-address") return "edge-address";
  return `unparseable(len=${raw === null ? 0 : raw.length},comma=${raw !== null && raw.includes(",")})`;
}
