// The out-of-band notice that a binding changed.
//
// This is the control that lets a SIM-swap victim notice a takeover in time to
// stop it, so the tests are about what it must always say and what it must
// never contain.

import test from "node:test";
import assert from "node:assert/strict";
import {
  NOTICE_KINDS,
  maskIdentifier,
  buildNotice,
  shouldNotify,
} from "../src/lib/channel-notice-core.mjs";

const AT = "2026-09-12T09:20:13.000Z";
const OLD = "+971554292699";
const NEW = "+447700900123";
const ALL = Object.values(NOTICE_KINDS);

/* ── masking ───────────────────────────────────────────────────────────── */

test("A NOTICE NEVER REPRODUCES A FULL NUMBER", () => {
  const masked = maskIdentifier(OLD);
  assert.equal(masked, "••••2699", "only the last four digits");
  assert.ok(
    !masked.includes("971554"),
    "an email gets forwarded and sits in an inbox for years — it is the single most likely place for a number to leak",
  );
  assert.equal(maskIdentifier("12025551234@s.whatsapp.net"), "••••1234", "a JID masks the same way");
});

test("maskIdentifier degrades to something human, never to a crash", () => {
  for (const raw of [null, undefined, 5, {}, "", "12", "abc"]) {
    assert.equal(maskIdentifier(raw), "your number", `${String(raw)} has nothing safe to show`);
  }
});

/* ── the copy contract ─────────────────────────────────────────────────── */

test("EVERY NOTICE SAYS WHAT, WHEN, AND WHAT TO DO IF IT WASN'T THEM", () => {
  for (const kind of ALL) {
    const r = buildNotice({ kind, oldIdentifier: OLD, newIdentifier: NEW, atIso: AT, secureAccountUrl: "https://mira.vualet.com/mira/account" });
    assert.equal(r.ok, true, `${kind} builds`);

    assert.ok(r.notice.subject.length > 0, `${kind} has a subject`);
    assert.ok(!r.notice.subject.includes("!"), `${kind} must not shout at somebody being attacked`);
    assert.ok(r.notice.text.includes(AT), `${kind} says when`);
    assert.ok(
      /wasn't you/i.test(r.notice.text),
      `${kind} must always carry the "if this wasn't you" line — that sentence is the entire reason the email is sent`,
    );
    assert.ok(r.notice.text.includes("https://mira.vualet.com"), `${kind} tells them where to go`);
  }
});

test("a number change names both numbers, masked", () => {
  const { notice } = buildNotice({ kind: NOTICE_KINDS.NUMBER_CHANGED, oldIdentifier: OLD, newIdentifier: NEW, atIso: AT });
  assert.ok(notice.text.includes("••••2699"), "the number they had");
  assert.ok(notice.text.includes("••••0123"), "and the number it became");
  assert.ok(
    !notice.text.includes(OLD) && !notice.text.includes(NEW),
    "neither in full — recognising which number is enough, reusing it is not",
  );
});

test("with no account URL it still tells them to act", () => {
  for (const url of [undefined, null, "", "   ", 5]) {
    const { notice } = buildNotice({ kind: NOTICE_KINDS.NUMBER_CHANGED, oldIdentifier: OLD, newIdentifier: NEW, atIso: AT, secureAccountUrl: url });
    assert.ok(
      /contact support/i.test(notice.text),
      "a notice with no next step is a notice that achieves nothing",
    );
  }
});

/* ── what must never appear ────────────────────────────────────────────── */

test("A NOTICE LEAKS NO INTERNALS", () => {
  for (const kind of ALL) {
    const { notice } = buildNotice({
      kind,
      oldIdentifier: OLD,
      newIdentifier: NEW,
      atIso: AT,
      secureAccountUrl: "https://mira.vualet.com/mira/account",
    });
    const all = `${notice.subject} ${notice.text} ${notice.html}`.toLowerCase();
    for (const leak of [
      "acct_", "bnd_", "mig_", "rec_", "tok_",
      "superseded", "reauth_required", "failover", "binding_id", "accountid",
      "hash", "token",
    ]) {
      assert.ok(!all.includes(leak), `${kind} leaked "${leak}" to a customer's inbox`);
    }
  }
});

test("THE HTML ESCAPES EVERYTHING INTERPOLATED", () => {
  const evil = 'https://evil.test/"><script>alert(1)</script>';
  const { notice } = buildNotice({
    kind: NOTICE_KINDS.NUMBER_CHANGED,
    oldIdentifier: OLD,
    newIdentifier: NEW,
    atIso: '2026-09-12<script>alert(2)</script>',
    secureAccountUrl: evil,
  });
  assert.ok(
    !notice.html.includes("<script>"),
    "a notice about a security event must not itself be an injection vector",
  );
  assert.ok(notice.html.includes("&lt;script&gt;"), "the payload is escaped, not stripped, so it is still visible");
  assert.ok(
    notice.html.includes("&quot;&gt;"),
    'the quote that would have closed the href attribute is escaped, so the URL cannot break out of it',
  );
  // Exactly one href, and it ends where it should.
  const hrefs = notice.html.match(/href="[^"]*"/g) || [];
  assert.equal(hrefs.length, 1, "one link, not one link plus whatever the attacker appended");
});

test("text and html carry the same facts", () => {
  const { notice } = buildNotice({ kind: NOTICE_KINDS.NUMBER_CHANGED, oldIdentifier: OLD, newIdentifier: NEW, atIso: AT });
  for (const fact of ["••••2699", "••••0123", AT]) {
    assert.ok(notice.text.includes(fact), `text carries ${fact}`);
    assert.ok(notice.html.includes(fact), `and so does html — a customer reading either must learn the same thing`);
  }
});

/* ── refusals ──────────────────────────────────────────────────────────── */

test("buildNotice refuses what it cannot describe", () => {
  assert.equal(buildNotice({ kind: "MADE_UP", atIso: AT }).ok, false, "an invented kind");
  assert.equal(
    buildNotice({ kind: "constructor", atIso: AT }).ok,
    false,
    "and a prototype key, which a bare property lookup would have accepted",
  );
  for (const atIso of [undefined, "", "   ", 5, null]) {
    assert.equal(buildNotice({ kind: NOTICE_KINDS.NUMBER_CHANGED, atIso }).ok, false, `atIso ${String(atIso)}`);
  }
  for (const input of [null, undefined, "nope", 5, []]) {
    assert.equal(buildNotice(input).ok, false, `${String(input)} is refused, not thrown on`);
  }
});

/* ── the channel rule ──────────────────────────────────────────────────── */

test("WHATSAPP IS NEVER THE CHANNEL FOR THIS", () => {
  for (const kind of ALL) {
    const r = shouldNotify(kind, true);
    assert.equal(r.notify, true, `${kind} is worth telling them about`);
    assert.equal(
      r.channel,
      "email",
      "the change may have been made by whoever now controls that number, so sending the warning there would tell the attacker and nobody else",
    );
  }
});

test("with no verified email there is no out-of-band channel", () => {
  for (const has of [false, undefined, null, "yes", 1]) {
    const r = shouldNotify(NOTICE_KINDS.NUMBER_CHANGED, has);
    assert.equal(r.notify, false, `${String(has)} is not a verified email`);
    assert.equal(r.channel, null, "and there is nowhere safe to send it");
    assert.ok(r.reason.length > 0, "which is worth recording");
  }
});

test("shouldNotify never throws", () => {
  for (const kind of [null, undefined, 5, {}, "NOPE"]) {
    assert.equal(shouldNotify(kind, true).notify, false, `${String(kind)} notifies nobody`);
  }
});
