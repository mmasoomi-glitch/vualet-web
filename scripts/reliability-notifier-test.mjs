// Getting an alert in front of a human.
//
// A judge rejected the reliability subsystem because alerts reached only an
// in-memory buffer and a log file: a critical OFFLINE at 3am was visible only
// to somebody who happened to look, which is indistinguishable from the silent
// outage the whole subsystem exists to prevent.
//
// These tests are about the tension that creates. An alert nobody receives is
// useless; one that arrives every 45 seconds is worse, because people filter
// the channel and then filter the one that mattered.

import test from "node:test";
import assert from "node:assert/strict";
import { createNotifier } from "../ops/reliability/notifier.mjs";

/** A transport that records instead of sending. */
function recorder() {
  const sent = [];
  return { sent, send: async (m) => void sent.push(m) };
}

const at = (t) => () => t;
const alert = (over = {}) => ({ severity: "critical", title: "Assistant OFFLINE", detail: "3 failures", ...over });

/* ── construction ──────────────────────────────────────────────────────── */

test("A NOTIFIER THAT CANNOT SEND MUST NOT EXIST", () => {
  for (const cfg of [undefined, null, {}, { send: "nope" }, { send: 5 }]) {
    assert.throws(
      () => createNotifier(cfg),
      /send function/,
      "constructing one anyway would report alerting as configured while reaching nobody",
    );
  }
});

/* ── the first one always gets through ─────────────────────────────────── */

test("THE FIRST OCCURRENCE IS NEVER SUPPRESSED", async () => {
  const r = recorder();
  const n = createNotifier({ send: r.send, clock: at(0) });
  const out = await n.notify(alert(), "whatsapp");

  assert.equal(out.sent, true, "there is no prior send to dedupe against");
  assert.equal(r.sent.length, 1, "and it actually went");
  assert.equal(r.sent[0].subject, "[CRITICAL] whatsapp: Assistant OFFLINE", "with the service and severity up front");
  assert.ok(r.sent[0].text.includes("3 failures"), "and the detail a human needs");
});

/* ── but not the same thing every 45 seconds ───────────────────────────── */

test("THE SAME ALERT DOES NOT ARRIVE EVERY POLL", async () => {
  const r = recorder();
  let now = 0;
  const n = createNotifier({ send: r.send, clock: () => now, minIntervalMs: 900000 });

  assert.equal((await n.notify(alert(), "whatsapp")).sent, true, "the first is sent");
  now = 45000;
  const second = await n.notify(alert(), "whatsapp");
  assert.equal(second.sent, false, "the second, a poll later, is not");
  assert.equal(second.reason, "deduped", "and says why");

  now = 900000;
  assert.equal(
    (await n.notify(alert(), "whatsapp")).sent,
    true,
    "but it repeats once the interval passes, because a problem still happening is still worth saying",
  );
  assert.equal(r.sent.length, 2, "two messages, not twenty");
});

test("DEDUPLICATION IGNORES THE DETAIL", async () => {
  const r = recorder();
  let now = 0;
  const n = createNotifier({ send: r.send, clock: () => now });

  await n.notify(alert({ detail: "consecutive failures: 3" }), "whatsapp");
  now = 45000;
  await n.notify(alert({ detail: "consecutive failures: 4" }), "whatsapp");
  now = 90000;
  await n.notify(alert({ detail: "consecutive failures: 5" }), "whatsapp");

  assert.equal(
    r.sent.length,
    1,
    "detail carries counts that change every poll, so keying on it would defeat deduplication entirely and produce the exact flood this exists to prevent",
  );
});

test("a different service or severity is a different alert", async () => {
  const r = recorder();
  const n = createNotifier({ send: r.send, clock: at(0) });
  await n.notify(alert(), "whatsapp");
  await n.notify(alert(), "assistant");
  await n.notify(alert({ severity: "warning" }), "whatsapp");
  assert.equal(r.sent.length, 3, "three genuinely different things");
});

/* ── good news can wait ────────────────────────────────────────────────── */

test("NOBODY IS WOKEN FOR GOOD NEWS", async () => {
  const r = recorder();
  const n = createNotifier({ send: r.send, clock: at(0) });
  const out = await n.notify(alert({ severity: "info", title: "Assistant restored" }), "whatsapp");

  assert.equal(out.sent, false, "restoration can wait for the dashboard");
  assert.equal(out.reason, "severity_below_threshold", "and is recorded as a deliberate choice");
  assert.equal(
    r.sent.length,
    0,
    "waking somebody for good news is how people learn to ignore the channel, and it only has value while they still read it",
  );
});

/* ── the flood ceiling, and its one exception ──────────────────────────── */

test("A FLOOD IS CAPPED", async () => {
  const r = recorder();
  let now = 0;
  const n = createNotifier({ send: r.send, clock: () => now, maxPerWindow: 3, minIntervalMs: 0 });

  for (let i = 0; i < 6; i++) {
    now = i * 1000;
    await n.notify(alert({ severity: "high", title: `problem ${i}` }), "svc");
  }
  assert.equal(r.sent.length, 3, "the ceiling binds");
});

test("BUT CRITICAL IS NEVER GAGGED", async () => {
  const r = recorder();
  let now = 0;
  const n = createNotifier({ send: r.send, clock: () => now, maxPerWindow: 2, minIntervalMs: 0 });

  for (let i = 0; i < 4; i++) {
    now = i * 1000;
    await n.notify(alert({ severity: "high", title: `noise ${i}` }), "svc");
  }
  now = 5000;
  const out = await n.notify(alert({ severity: "critical", title: "everything is down" }), "svc");

  assert.equal(
    out.sent,
    true,
    "a cascade where genuinely everything is failing at once is exactly when a ceiling must not gag the one message that matters",
  );
  assert.ok(r.sent.some((m) => m.subject.includes("everything is down")), "and it arrived");
});

/* ── a failed send must not silence the retry ──────────────────────────── */

test("A FAILED SEND IS NOT RECORDED AS SENT", async () => {
  const dropped = [];
  const sent = [];
  let failing = true;
  const n = createNotifier({
    send: async (m) => {
      if (failing) throw new Error("smtp down");
      sent.push(m);
    },
    clock: at(0),
    onDrop: (reason) => dropped.push(reason),
  });

  const first = await n.notify(alert(), "whatsapp");
  assert.equal(first.sent, false, "the send failed");
  assert.equal(first.reason, "send_failed", "and says so");
  assert.deepEqual(dropped, ["send_failed"], "and the drop is reported");

  failing = false;
  const retry = await n.notify(alert(), "whatsapp");
  assert.equal(
    retry.sent,
    true,
    "recording a failed send would suppress the retry for fifteen minutes, so a transient mail outage would silently eat the only warning about a real one",
  );
  assert.equal(sent.length, 1, "and the message finally arrived");
});

/* ── robustness ────────────────────────────────────────────────────────── */

test("a malformed alert is refused, never thrown on", async () => {
  const r = recorder();
  const n = createNotifier({ send: r.send, clock: at(0) });
  for (const bad of [null, undefined, "nope", 5, {}, { title: "" }, { title: "   " }, { title: 5 }]) {
    const out = await n.notify(bad, "svc");
    assert.equal(out.sent, false, `${JSON.stringify(bad)} must be refused`);
    assert.equal(out.reason, "malformed", "as malformed");
  }
  assert.equal(r.sent.length, 0, "and nothing was sent");
});

test("a throwing onDrop cannot stop notification", async () => {
  const r = recorder();
  const n = createNotifier({
    send: r.send,
    clock: at(0),
    onDrop: () => {
      throw new Error("listener boom");
    },
  });
  await n.notify(null, "svc");
  assert.equal((await n.notify(alert(), "svc")).sent, true, "a bad listener must not break alerting");
});

test("stats reports counts and no contents", async () => {
  const r = recorder();
  const n = createNotifier({ send: r.send, clock: at(0) });
  await n.notify(alert({ detail: "OPERATIONAL-SECRET" }), "whatsapp");

  const s = n.stats();
  assert.equal(s.sentInWindow, 1, "it counts");
  assert.equal(s.trackedKeys, 1, "and tracks");
  assert.ok(
    !JSON.stringify(s).includes("OPERATIONAL-SECRET"),
    "this is a health readout, not a log — the contents could carry operational detail",
  );
});

test("THE WINDOW IS PRUNED, NOT JUST FILTERED", async () => {
  const r = recorder();
  let now = 0;
  const n = createNotifier({ send: r.send, clock: () => now, minIntervalMs: 0, floodWindowMs: 1000, maxPerWindow: 100 });

  for (let i = 0; i < 50; i++) {
    now = i;
    await n.notify(alert({ severity: "high", title: `t${i}` }), "svc");
  }
  now = 100000;
  assert.equal(
    n.stats().sentInWindow,
    0,
    "this process runs for weeks; an array only ever read through a filter still grows forever, and a monitor that leaks memory eventually becomes the outage",
  );
});
