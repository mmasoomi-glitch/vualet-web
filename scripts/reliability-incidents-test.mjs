// Assistant reliability — the incident history.
//
// No filesystem. The log's I/O is injected, so every case below — including a
// disk that fails mid-write — is exercised in memory.

import test from "node:test";
import assert from "node:assert/strict";
import {
  redactDetail,
  buildEvent,
  serialiseEvent,
  parseLine,
  foldIncidents,
  createIncidentLog,
} from "../ops/reliability/incidents.mjs";

function makeIo(initial = []) {
  const lines = [...initial];
  const calls = { append: 0, replace: 0, read: 0 };
  return {
    lines,
    calls,
    io: {
      appendLine: async (_p, line) => {
        calls.append++;
        lines.push(line);
      },
      readLines: async () => {
        calls.read++;
        return [...lines];
      },
      replaceAll: async (_p, next) => {
        calls.replace++;
        lines.length = 0;
        lines.push(...next);
      },
    },
  };
}

/** The counters still increment, so a test can prove the attempt was made. */
function makeFailingAppendIo(initial = []) {
  const h = makeIo(initial);
  h.io.appendLine = async () => {
    h.calls.append++;
    throw new Error("disk full");
  };
  return h;
}

function makeFailingReadIo(initial = []) {
  const h = makeIo(initial);
  h.io.readLines = async () => {
    h.calls.read++;
    throw new Error("unreadable");
  };
  return h;
}

const logWith = (h, maxLines = 10) =>
  createIncidentLog({ filePath: "incidents.jsonl", io: h.io, maxLines });

/** A full, valid event, varying only what the test cares about. */
function ev(over) {
  return {
    id: "e1",
    atMs: 1000,
    service: "assistant",
    type: "event",
    from: null,
    to: null,
    state: null,
    reason: null,
    incidentId: null,
    detail: {},
    ...over,
  };
}

/* ── redaction ─────────────────────────────────────────────────────────── */

test("REDACTION IS A HARD BOUNDARY", () => {
  const secrets = {
    apiKey: "sk-live-123",
    Authorization: "Bearer abc",
    sessionToken: "sess-abc",
    customerPhone: "+971554292699",
    userEmail: "someone@example.com",
    accountJid: "9715@s.whatsapp.net",
  };
  const out = redactDetail({ ...secrets, latencyMs: 42 });
  const json = JSON.stringify(out);

  for (const key of Object.keys(secrets)) {
    assert.equal(out[key], "[redacted]", `${key} must be redacted`);
    assert.ok(
      !json.includes(secrets[key]),
      `the value of ${key} reached the log — an incident log is read by humans, shipped around and kept for a long time`,
    );
  }
  assert.equal(out.latencyMs, 42, "a harmless field is kept, or the log tells you nothing");
  assert.ok("apiKey" in out, "the KEY is kept so an operator can see something was withheld");
});

test("a nested object cannot smuggle a secret past the key filter", () => {
  const out = redactDetail({ nested: { apiKey: "sk-live-123" } });
  assert.equal(out.nested, "[omitted]", "nesting is not stored");
  assert.ok(
    !JSON.stringify(out).includes("sk-live-123"),
    "the key filter only sees top-level names, so a nested value must never be serialised at all",
  );
});

test("A LONG STRING IS TRUNCATED", () => {
  const out = redactDetail({ body: "x".repeat(500) });
  assert.equal(out.body.length, 201, "200 characters plus one ellipsis");
  assert.equal(out.body.at(-1), "…", "the truncation is visible");
  assert.ok(
    !out.body.includes("x".repeat(201)),
    "a probe body or a model reply must never be dumped into the log wholesale",
  );
});

test("redactDetail preserves the harmless and omits the unserialisable", () => {
  const out = redactDetail({
    nil: null,
    num: 42,
    yes: true,
    obj: {},
    arr: [1, 2],
    fn: () => {},
    undef: undefined,
    sym: Symbol("s"),
  });
  assert.equal(out.nil, null, "null is a real value and is preserved");
  assert.equal(out.num, 42, "numbers pass through");
  assert.equal(out.yes, true, "booleans pass through");
  for (const key of ["obj", "arr", "fn", "undef", "sym"]) {
    assert.equal(out[key], "[omitted]", `${key} cannot be a flat log value`);
  }
});

test("redactDetail is defensive about its input", () => {
  for (const input of [null, undefined, "string", 123, [1, 2], true]) {
    assert.deepEqual(redactDetail(input), {}, `${String(input)} must yield an empty detail`);
  }
});

/* ── buildEvent ────────────────────────────────────────────────────────── */

test("an event without an id, a service or a real timestamp is refused", () => {
  const refused = [
    {},
    { id: "1" },
    { service: "s" },
    { id: "", service: "s", atMs: 1 },
    { id: "   ", service: "s", atMs: 1 },
    { id: "1", service: "", atMs: 1 },
    { id: "1", service: "  ", atMs: 1 },
    { id: "1", service: "s", atMs: NaN },
    { id: "1", service: "s", atMs: Infinity },
    { id: "1", service: "s", atMs: "1" },
    { id: 5, service: "s", atMs: 1 },
  ];
  for (const input of refused) {
    const r = buildEvent(input);
    assert.equal(r.ok, false, `${JSON.stringify(input)} must be refused`);
    assert.ok(typeof r.reason === "string" && r.reason.length > 0, "a refusal carries a reason");
  }
});

test("buildEvent never throws on a garbage input", () => {
  for (const input of [null, undefined, "nope", 7]) {
    assert.equal(buildEvent(input).ok, false, `${String(input)} is refused, not thrown on`);
  }
});

test("buildEvent fills the defaults", () => {
  const r = buildEvent({ id: "1", service: "s", atMs: 1000 });
  assert.equal(r.ok, true, "the minimum is enough");
  assert.deepEqual(
    Object.keys(r.event).sort(),
    ["atMs", "detail", "from", "id", "incidentId", "reason", "service", "state", "to", "type"],
    "the shape is fixed, so every line in the file parses the same way",
  );
  assert.equal(r.event.type, "event", "type defaults");
  for (const key of ["from", "to", "state", "reason", "incidentId"]) {
    assert.equal(r.event[key], null, `${key} defaults to null rather than being absent`);
  }
  assert.deepEqual(r.event.detail, {}, "an absent detail is an empty object");
});

test("buildEvent redacts the detail it is given", () => {
  const r = buildEvent({ id: "1", service: "s", atMs: 1, detail: { apiKey: "sk-live", ok: true } });
  assert.equal(r.event.detail.apiKey, "[redacted]", "redaction is not optional on the way in");
  assert.equal(r.event.detail.ok, true, "the rest survives");
});

/* ── serialise / parse ─────────────────────────────────────────────────── */

test("an event serialises to exactly one line", () => {
  const line = serialiseEvent(ev({ reason: "line one\nline two" }));
  assert.ok(!line.includes("\n"), "a raw newline would tear the line in two");
  assert.ok(!line.includes("\r"), "and so would a carriage return");
  assert.equal(JSON.parse(line).id, "e1", "it still round-trips");
});

test("a torn or empty line is skipped, not fatal", () => {
  for (const line of ["", "   ", "not json", '{"id":"b",BROKEN', 123, null, undefined]) {
    assert.equal(parseLine(line), null, `${String(line)} must parse to null`);
  }
  for (const scalar of ['"5"', "true", "5", "null"]) {
    assert.equal(parseLine(scalar), null, `${scalar} is not an event object`);
  }
  assert.equal(parseLine('{"id":"a"}').id, "a", "a good line still parses");
});

/* ── foldIncidents ─────────────────────────────────────────────────────── */

test("foldIncidents is defensive", () => {
  for (const input of [null, undefined, "garbage", 123, []]) {
    assert.deepEqual(foldIncidents(input), [], `${String(input)} folds to nothing`);
  }
  assert.deepEqual(foldIncidents([null, 5, "x", {}]), [], "garbage entries carry no incident");
});

test("events with no incident are ignored", () => {
  const out = foldIncidents([ev({ atMs: 1000 }), ev({ id: "e2", atMs: 2000, incidentId: "inc_1" })]);
  assert.equal(out.length, 1, "only the event belonging to an incident counts");
  assert.equal(out[0].incidentId, "inc_1", "and it is the right one");
});

test("an incident closed by a HEALTHY transition reads as resolved", () => {
  const out = foldIncidents([
    ev({ atMs: 1000, to: "OFFLINE", state: "OFFLINE", incidentId: "inc_1" }),
    ev({ id: "e2", atMs: 5000, to: "HEALTHY", state: "HEALTHY", incidentId: "inc_1" }),
  ]);
  assert.equal(out[0].resolved, true, "a transition TO healthy ends the incident");
  assert.equal(out[0].opened, false, "and it is no longer open");
  assert.equal(out[0].startedAtMs, 1000, "it started at the first event");
  assert.equal(out[0].endedAtMs, 5000, "and ended at the last");
  assert.equal(out[0].durationMs, 4000, "which is how long the customer was affected");
  assert.equal(out[0].eventCount, 2, "every event is counted");
  assert.equal(out[0].worstState, "OFFLINE", "the worst it ever got is what matters");
});

test("an incident with only a HEALTHY state reading is still open", () => {
  const out = foldIncidents([ev({ atMs: 1000, to: null, state: "HEALTHY", incidentId: "inc_1" })]);
  assert.equal(
    out[0].resolved,
    false,
    "a probe reporting a healthy state mid-incident does not close it; only a transition does",
  );
  assert.equal(
    out[0].worstState,
    "HEALTHY",
    "an incident that only ever saw HEALTHY must not report UNKNOWN, which outranks it in the severity order",
  );
});

test("incidents are newest first", () => {
  const out = foldIncidents([
    ev({ atMs: 3000, incidentId: "inc_new" }),
    ev({ id: "e2", atMs: 1000, incidentId: "inc_old" }),
  ]);
  assert.equal(out[0].incidentId, "inc_new", "an operator reads the most recent first");
  assert.equal(out[1].incidentId, "inc_old", "older incidents follow");
});

/* ── the log ───────────────────────────────────────────────────────────── */

test("createIncidentLog fails loudly on a bad configuration", () => {
  const good = { appendLine: async () => {}, readLines: async () => [], replaceAll: async () => {} };
  assert.throws(() => createIncidentLog(), /filePath/, "no argument at all");
  assert.throws(() => createIncidentLog({}), /filePath/, "no filePath");
  assert.throws(() => createIncidentLog({ filePath: "  ", io: good }), /filePath/, "a blank filePath");
  assert.throws(() => createIncidentLog({ filePath: "f.jsonl" }), /io/, "no io");
  assert.throws(() => createIncidentLog({ filePath: "f.jsonl", io: {} }), /io/, "an empty io");
  for (const missing of ["appendLine", "readLines", "replaceAll"]) {
    const partial = { ...good };
    delete partial[missing];
    assert.throws(
      () => createIncidentLog({ filePath: "f.jsonl", io: partial }),
      /io/,
      `io without ${missing} must be refused at startup, not at 3am`,
    );
  }
});

test("record appends exactly one line", async () => {
  const h = makeIo();
  const log = logWith(h);
  const r = await log.record({ id: "1", service: "assistant", atMs: 1000, to: "OFFLINE" });
  assert.equal(r.ok, true, "a valid event is recorded");
  assert.equal(h.calls.append, 1, "exactly one append");
  assert.equal(h.lines.length, 1, "exactly one line");
  assert.equal(JSON.parse(h.lines[0]).to, "OFFLINE", "and it is the event that was recorded");
});

test("A REFUSED EVENT IS NEVER WRITTEN", async () => {
  const h = makeIo();
  const r = await logWith(h).record({ service: "assistant" });
  assert.equal(r.ok, false, "an event with no id is refused");
  assert.equal(h.calls.append, 0, "nothing may reach the file that could not be built");
});

test("LOSING A LOG LINE MUST NOT TAKE DOWN THE MONITOR", async () => {
  const h = makeFailingAppendIo();
  const r = await logWith(h).record({ id: "1", service: "assistant", atMs: 1000 });
  assert.equal(r.ok, false, "the caller is told the write failed");
  assert.ok(typeof r.reason === "string" && r.reason.length > 0, "and why");
  assert.equal(h.calls.append, 1, "the write really was attempted, so the test is not vacuous");
});

test("a torn final line does not destroy the history", async () => {
  const h = makeIo(['{"id":"a","atMs":1,"service":"s"}', '{"id":"b",BROKEN']);
  const out = await logWith(h).list(10);
  assert.equal(out.length, 1, "the readable events survive");
  assert.equal(
    out[0].id,
    "a",
    "an append-only log torn by a crash must still yield everything written before the tear",
  );
});

test("list returns the most recent, newest first", async () => {
  const h = makeIo();
  const log = logWith(h);
  for (let i = 1; i <= 5; i++) await log.record({ id: `e${i}`, service: "assistant", atMs: i });
  const out = await log.list(3);
  assert.equal(out.length, 3, "the limit is honoured");
  assert.deepEqual(out.map((e) => e.id), ["e5", "e4", "e3"], "newest first");
});

test("an unreadable log is a degraded view, not an outage", async () => {
  const h = makeFailingReadIo();
  const log = logWith(h);
  assert.deepEqual(await log.list(10), [], "list yields nothing rather than throwing");
  assert.deepEqual(await log.incidents(10), [], "so does incidents");
  assert.deepEqual(await log.prune(), { pruned: 0 }, "and prune reports nothing pruned");
});

test("incidents folds what was written", async () => {
  const h = makeIo();
  const log = logWith(h);
  await log.record({ id: "1", service: "assistant", atMs: 1000, to: "OFFLINE", incidentId: "inc_1" });
  await log.record({ id: "2", service: "assistant", atMs: 4000, to: "HEALTHY", incidentId: "inc_1" });
  const out = await log.incidents(10);
  assert.equal(out.length, 1, "two events, one incident");
  assert.equal(out[0].durationMs, 3000, "the outage lasted three seconds");
  assert.equal(out[0].resolved, true, "and it is over");
});

test("prune leaves a log under the ceiling alone", async () => {
  const h = makeIo(["a", "b"]);
  const r = await logWith(h, 10).prune();
  assert.deepEqual(r, { pruned: 0 }, "nothing to do");
  assert.equal(h.calls.replace, 0, "and no needless rewrite of the file");
});

test("prune keeps the most recent lines", async () => {
  const h = makeIo(["l1", "l2", "l3", "l4", "l5"]);
  const r = await logWith(h, 3).prune();
  assert.equal(r.pruned, 2, "two lines dropped");
  assert.equal(h.calls.replace, 1, "rewritten once");
  assert.deepEqual(h.lines, ["l3", "l4", "l5"], "the OLDEST are dropped, never the newest");
});
