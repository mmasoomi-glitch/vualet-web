// The message to a customer whose assistant went silent.
//
// This is the most customer-visible thing in the codebase and it is an apology
// for our own fault, so most of these tests are about honesty: that it does not
// claim something we have not done, does not leak what a customer should never
// see, and does not read like marketing.

import test from "node:test";
import assert from "node:assert/strict";
import { OUTAGE_OFFER, describeOffer, buildOutageNotice } from "../src/lib/outage-notice-core.mjs";

const URL_ = "https://mira.vualet.com/mira/reconnect";
const base = (over = {}) => ({
  reconnectUrl: URL_,
  offer: OUTAGE_OFFER,
  sinceIso: "2026-09-07T09:00:00.000Z",
  nowIso: "2026-09-12T09:00:00.000Z",
  supportEmail: "support@vualet.com",
  ...over,
});

const both = (n) => `${n.subject}\n${n.text}\n${n.html}`;

/* ── honesty ───────────────────────────────────────────────────────────── */

test("IT NEVER CLAIMS THE CREDIT IS ALREADY APPLIED", () => {
  const { notice } = buildOutageNotice(base());
  const all = both(notice).toLowerCase();

  for (const lie of ["already applied", "has been applied", "have been added", "already added", "credited to"]) {
    assert.ok(
      !all.includes(lie),
      `"${lie}" would be false: entitlement is gated on subscription status alone, and extending a period happens in the payment processor's admin, which this code cannot do. A lie inside an apology is worse than the original fault.`,
    );
  }
  assert.ok(/we are also adding/i.test(notice.text), "it commits to doing it instead");
});

test("THE SUBJECT DOES NOT PROMISE SOMETHING UNTRUE", () => {
  const { notice } = buildOutageNotice(base());
  assert.ok(
    !/is back|working again|restored|is fixed/i.test(notice.subject),
    "she is NOT back until they reconnect — a subject claiming otherwise is the first thing they would find out was wrong",
  );
  assert.ok(!notice.subject.includes("!"), "no exclamation mark in an apology");
  assert.ok(notice.subject.length > 20, "and it says something specific");
});

test("IT NEVER ASSERTS A CAUSE WE COULD NOT PROVE", () => {
  const { notice } = buildOutageNotice(base());
  const all = both(notice).toLowerCase();

  // Before sending, the store showed no tenant id and no bound identifier on any
  // affected subscription, and their connect records had already expired. So we
  // cannot distinguish "we broke an established connection" from "they never
  // finished pairing". Telling somebody in the second group that we broke their
  // connection teaches them we do not know what happened to them.
  for (const claim of [
    "broke the connection", "we broke", "something we changed",
    "our fault", "a change on our side", "went wrong on our end",
  ]) {
    assert.ok(
      !all.includes(claim),
      `"${claim}" names a cause the evidence does not support. Only assert what is provable: they pay, and they have no working assistant.`,
    );
  }
});

test("IT DOES NOT BLAME THE CUSTOMER EITHER", () => {
  const { notice } = buildOutageNotice(base());
  const all = both(notice).toLowerCase();
  // The mirror image of the error above. Not knowing the cause is not licence
  // to imply they failed to finish something.
  for (const blame of ["you did not", "you never", "you forgot", "you failed", "incomplete setup"]) {
    assert.ok(!all.includes(blame), `"${blame}" blames somebody we have no evidence against`);
  }
  assert.ok(/not doing anything wrong/i.test(notice.text), "it says so explicitly");
});

test("it leads with the one thing that IS certain", () => {
  const { notice } = buildOutageNotice(base());
  const first = notice.text.split("\n\n")[0].toLowerCase();
  assert.ok(/is not connected/.test(first), "the first sentence states the verified fact");
  assert.ok(/our job to put right/.test(first), "and takes responsibility without inventing a cause");
  assert.ok(
    !/we wanted to let you know|we are reaching out|we are writing to/i.test(notice.text),
    "no throat-clearing — it makes an annoyed reader wait for the point",
  );
});

test("IT SAYS WHAT THEY WILL ACTUALLY BE WORRIED ABOUT", () => {
  const { notice } = buildOutageNotice(base());
  const t = notice.text.toLowerCase();
  assert.ok(/nothing is lost/.test(t), "their first fear is that they lost everything");
  assert.ok(/subscription/.test(t) && /learned/.test(t) && /settings/.test(t), "named specifically");
  assert.ok(/costs nothing|free/.test(t), "their second fear is being charged again");
  assert.ok(/about a minute/.test(t), "and how long it will take them");
});

/* ── what must never appear ────────────────────────────────────────────── */

test("NO INTERNAL LANGUAGE REACHES A CUSTOMER", () => {
  const { notice } = buildOutageNotice(base());
  const all = both(notice).toLowerCase();
  for (const word of [
    "outage", "incident", "degraded", "offline", "jid", "whatsapp.net",
    "token", "binding", "tenant", "kek", "credential", "probe", "gateway",
    "acct_", "+971", "null", "undefined",
  ]) {
    assert.ok(!all.includes(word), `"${word}" is our vocabulary, not theirs`);
  }
});

test("A TIMESTAMP IS NEVER PASTED INTO A SENTENCE", () => {
  const { notice } = buildOutageNotice(base());
  assert.ok(
    !/\d{4}-\d{2}-\d{2}T/.test(notice.text),
    "an ISO timestamp reads like a log line and makes them do arithmetic to find out how long they lost",
  );
  assert.ok(/has not been for 5 days/.test(notice.text), "it says it the way a person would");
});

test("the duration degrades gracefully rather than guessing", () => {
  for (const over of [{ sinceIso: null }, { sinceIso: "" }, { nowIso: null }, { sinceIso: "not a date" }, { nowIso: "2026-09-01T00:00:00Z" }]) {
    const { notice } = buildOutageNotice(base(over));
    assert.ok(/is not connected to your WhatsApp/.test(notice.text), `${JSON.stringify(over)} still reads properly`);
    assert.ok(!/WhatsApp and has not been,/.test(notice.text), "and never leaves a dangling clause");
    assert.ok(!/NaN|Invalid|undefined/.test(notice.text), "and never shows the reader a broken value");
  }
  assert.ok(/since yesterday/.test(buildOutageNotice(base({ sinceIso: "2026-09-11T09:00:00.000Z" })).notice.text), "one day reads as yesterday");
});

/* ── the action ────────────────────────────────────────────────────────── */

test("THERE IS EXACTLY ONE THING TO DO", () => {
  const { notice } = buildOutageNotice(base());
  const links = notice.html.match(/<a\s/g) || [];
  assert.equal(links.length, 1, "one link, so nothing competes with reconnecting");
  assert.ok(notice.html.includes(`href="${URL_}"`), "and it goes to the reconnect page");
  assert.ok(notice.text.includes(URL_), "with the plain-text version carrying the URL itself");
});

test("html and text carry the same facts", () => {
  const { notice } = buildOutageNotice(base());
  for (const fact of ["our job to put right", "Nothing is lost", "15 days of free usage", "support@vualet.com"]) {
    assert.ok(notice.text.includes(fact), `text carries "${fact}"`);
    assert.ok(notice.html.includes(fact), `and so does html`);
  }
});

test("the html escapes what it interpolates", () => {
  const { notice } = buildOutageNotice(
    base({ reconnectUrl: 'https://x.test/"><script>alert(1)</script>', supportEmail: '<b>ops</b>@x.test' }),
  );
  assert.ok(!notice.html.includes("<script>"), "an apology must not also be an injection vector");
  assert.ok(!notice.html.includes("<b>ops</b>"), "nor smuggle markup through the support address");
  assert.equal((notice.html.match(/<a\s/g) || []).length, 1, "and still exactly one link");
});

/* ── refusals ──────────────────────────────────────────────────────────── */

test("it refuses to build something unusable", () => {
  for (const over of [
    { reconnectUrl: "" }, { reconnectUrl: "   " }, { reconnectUrl: null }, { reconnectUrl: 5 },
    { offer: null }, { offer: { kind: "percent_off", value: 10 } },
    { offer: { kind: "free_days", value: 0 } }, { offer: { kind: "free_days", value: -1 } },
    { offer: { kind: "free_days", value: 1.5 } },
  ]) {
    const r = buildOutageNotice(base(over));
    assert.equal(r.ok, false, `${JSON.stringify(over)} must be refused`);
    assert.ok(r.reason.length > 0, "with a reason");
  }
  for (const input of [null, undefined, "nope", 5]) {
    assert.equal(buildOutageNotice(input).ok, false, `${String(input)} is refused, not thrown on`);
  }
});

test("describeOffer is human and defensive", () => {
  assert.equal(describeOffer({ kind: "free_days", value: 15 }), "15 days of free usage", "plural");
  assert.equal(describeOffer({ kind: "free_days", value: 1 }), "1 day of free usage", "singular");
  for (const junk of [null, undefined, {}, "nope", 5, { value: "x" }]) {
    assert.equal(describeOffer(junk), "", `${String(junk)} yields nothing rather than throwing`);
  }
});

test("the offer is the one the owner authorised", () => {
  assert.deepEqual(OUTAGE_OFFER, { kind: "free_days", value: 15 }, "15 free days");
  assert.ok(Object.isFrozen(OUTAGE_OFFER), "and it cannot be changed at runtime");
});
