# -*- coding: utf-8 -*-
import io, os
TESTDIR = os.path.join(r'C:\Ballerina-Motasadea-V1', 'apps', 'engine', 'test')

ROUTING = r'''import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/router.mjs';

// A TRUTH TABLE, not a spot check. classify() decides whether a customer's message becomes an
// ordinary chat turn or a BUILD JOB, and the two failure directions are not symmetric: the code
// comment in router.mjs states plainly that misrouting chat into a build is FAR more damaging,
// because a job returns a hardcoded "On it" with NO model call and, when the build yields nothing
// deliverable, the customer receives nothing at all. So every row that expects 'chat' is a
// safety assertion, and every row that expects 'job' is a regression guard on a paid feature.
const TABLE = [
  // ── THE LIVE BUG THIS CHANGE FIXES ───────────────────────────────────────────────────────
  // All four of these routed to a BUILD on the previous regex, because the generic nouns page,
  // site and api were treated as build artefacts. They are ordinary English.
  ['write a page of notes', 'chat'],
  ['make the site visit happen', 'chat'],
  ['create the api key', 'chat'],
  ['build the landing page number', 'chat'],

  // ── THE OWNER'S OWN WORDS, which never routed to a build ─────────────────────────────────
  // "she has to be able to write programs, produce executable files or simple APK files"
  ['build me a program', 'job'],
  ['can you write me an executable', 'job'],
  ['write me programs', 'job'],
  ['produce an executable file', 'job'],
  ['produce me an apk', 'job'],
  ['compile my program', 'job'],
  ['produce a report of last month', 'chat'], // 'report' is not an artefact - stays chat

  // ── REGRESSION GUARDS: every noun that routed before must still route ────────────────────
  ['build python scripts', 'job'],          // plural, NO article - Class A allows this
  ['make me an apk', 'job'],
  ['create a dashboard', 'job'],
  ['build me a bot', 'job'],
  ['can you build me a script', 'job'],     // polite lead-in preserved
  ['build me a simple python script', 'job'], // adjective slack preserved
  ['design me a landing page', 'job'],      // verb 'design' preserved
  ['code me a tool', 'job'],                // verb 'code' preserved
  ['can you create a website for me', 'job'],
  ['build me an api for my shop', 'job'],   // 'for' is not a qualifier - still a build
  ['make me an installer', 'job'],
  ['build a binary', 'job'],

  // ── ORDINARY CONVERSATION MUST NEVER BECOME A BUILD ──────────────────────────────────────
  ['write me a poem', 'chat'],
  ['make me a coffee', 'chat'],
  ['send me a file', 'chat'],               // 'send' is not a build verb, and 'file' is not a noun
  ['do not rebuild the app', 'chat'],       // NEGATED_OR_META runs BEFORE the regex
  ['stop building the app', 'chat'],
  ['hey mira, build me a script', 'job'],   // unanchored: a lead-in must not break the match
];

for (const [input, expected] of TABLE) {
  test(`classify(${JSON.stringify(input)}) -> ${expected}`, () => {
    assert.equal(classify(input), expected);
  });
}

test('the explicit /build command always wins', () => {
  assert.equal(classify('/build a thing'), 'job');
});

test('no catastrophic backtracking on an adversarial string', () => {
  // Nested optional groups plus a lookahead are exactly the shape that can blow up. The slack is
  // bounded at {0,2} and the alternatives are literal word lists, so this must return instantly.
  const evil = 'build ' + 'a '.repeat(400) + 'x'.repeat(400);
  const t0 = Date.now();
  classify(evil);
  const ms = Date.now() - t0;
  assert.ok(ms < 250, `classify() took ${ms}ms on an adversarial string - possible backtracking`);
});
'''

PRIVACY = r'''import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

// These are SOURCE-LEVEL guards, deliberately. respond() cannot be called in a unit test without a
// live tenant, a database and a model provider, but every defect they guard against is visible in
// the source: a template literal that prints customer text, a hardcoded token ceiling, and a
// discarded finish_reason. Asserting on the source is what makes them cheap enough to always run.
const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_SRC = join(HERE, '..', 'src');
const MIRA = readFileSync(join(ENGINE_SRC, 'mira.mjs'), 'utf8');
const LLM = readFileSync(join(ENGINE_SRC, 'llm.mjs'), 'utf8');

// The commit these counterfactuals are pinned to. NEVER pin a counterfactual to HEAD: HEAD moves
// the instant the fix is committed, so the "proof the bug was real" silently starts testing the
// FIXED code and passes for the wrong reason. This project has been burned by that three times.
const PRE_FIX_SHA = '242d0fd7a90717fbde103368a20e9fc7e5dc56b6';

function fileAt(sha, path) {
  try {
    return execFileSync('git', ['show', `${sha}:${path}`], {
      cwd: join(HERE, '..', '..', '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null; // shallow clone or missing object: skip rather than fail the suite
  }
}

test('PRIVACY: the evidence gate never prints reply text (requirements#96 clause 3)', () => {
  // The exact expression that wrote 120 characters of a customer's private reply into
  // /var/log/mira-whatsapp.log, where any local account could read it.
  assert.ok(
    !MIRA.includes('reply.slice(0, 120)'),
    'mira.mjs still contains reply.slice(0, 120) - customer reply text is being logged',
  );
  // Nothing anywhere in the file may interpolate the reply itself into a log call.
  const leaky = /console\.(warn|error|log|info)\([^\n]*\$\{reply(?!\.length)/;
  assert.ok(!leaky.test(MIRA), 'a console call interpolates ${reply} - that is a content leak');
});

test('PRIVACY: the gate still fires, using a correlatable fingerprint instead', () => {
  // Redaction that also removes the SIGNAL is not a fix - the drift monitor must keep working.
  assert.ok(MIRA.includes("createHash('sha256')"), 'no sha256 fingerprint in mira.mjs');
  assert.ok(MIRA.includes('[evidence-gate] UNVERIFIED claim'), 'the evidence gate stopped reporting');
  assert.ok(/hash=\$\{fp\}/.test(MIRA), 'the gate does not log a hash');
  assert.ok(/len=\$\{reply\.length\}/.test(MIRA), 'the gate does not log a length');
  assert.ok(MIRA.includes("import { createHash } from 'node:crypto'"), 'createHash is not imported');
});

test('PRIVACY: the catch block cannot re-open the leak through e.message', () => {
  // An exception thrown while inspecting the reply can carry the reply inside its own message.
  assert.ok(
    !MIRA.includes('[evidence-gate] check failed (non-blocking): ${e.message}'),
    'the evidence-gate catch still logs e.message, which can embed the reply text',
  );
  assert.ok(MIRA.includes('e?.constructor?.name'), 'the catch does not log the error type only');
});

test('COUNTERFACTUAL: the leak really existed at the pinned pre-fix commit', () => {
  const before = fileAt(PRE_FIX_SHA, 'apps/engine/src/mira.mjs');
  if (before === null) return; // object unavailable in this clone
  assert.ok(
    before.includes('reply.slice(0, 120)'),
    `expected the leak to be present at ${PRE_FIX_SHA}; if it is absent the pin is wrong`,
  );
});

test('BUDGET: the 160-token ceiling that truncated replies is gone', () => {
  assert.ok(!/maxTokens:\s*160\b/.test(MIRA), 'maxTokens: 160 is still present - replies will truncate');
  assert.ok(MIRA.includes('const replyBudget'), 'no replyBudget is computed');
  assert.ok(/maxTokens:\s*replyBudget/.test(MIRA), 'the chat call does not use replyBudget');
});

test('BUDGET: stays inside the WhatsApp ~4096-char limit, because nothing chunks a reply', () => {
  // The send path does sendMessage(jid, { text: out.reply }) with no splitter, so an over-long
  // reply FAILS TO SEND rather than arriving clipped. At ~3-4 chars/token the ceiling must stay
  // well under 4096 chars; 1000 tokens is ~3.5k chars, the last safe round number.
  const budgets = [...MIRA.matchAll(/replyBudget\s*=\s*([^;]+);/g)].map((m) => m[1]);
  assert.equal(budgets.length, 1, 'expected exactly one replyBudget assignment');
  const numbers = [...budgets[0].matchAll(/\b(\d{2,5})\b/g)].map((m) => Number(m[1]));
  assert.ok(numbers.length > 0, 'replyBudget has no numeric ceiling');
  for (const n of numbers) {
    assert.ok(n > 160, `budget ${n} is not an improvement on the old 160-token ceiling`);
    assert.ok(n <= 1000, `budget ${n} risks exceeding WhatsApp's ~4096-char limit with no splitter`);
  }
});

test('BUDGET: the persona no longer orders 1-3 sentence replies', () => {
  // The token ceiling was only half the cause. The persona literally instructed the model to keep
  // replies to 1-3 sentences and the model obeyed, so raising maxTokens alone changes nothing.
  assert.ok(!MIRA.includes('(1-3 sentences)'), 'the persona still instructs 1-3 sentence replies');
  assert.ok(MIRA.includes('never stop mid-thought'), 'the persona lost its completeness instruction');
});

test('TRUNCATION: finish_reason is surfaced by llm.mjs and consumed by mira.mjs', () => {
  // llm.mjs discarded finish_reason entirely, so mira.mjs could not tell a finished reply from a
  // guillotined one no matter what it checked.
  assert.ok(LLM.includes('finish_reason'), 'llm.mjs still discards finish_reason');
  assert.ok(
    /finish_reason:\s*d\.choices\?\.\[0\]\?\.finish_reason/.test(LLM),
    'finish_reason is not read from the provider response',
  );
  assert.ok(MIRA.includes("r.finish_reason === 'length'"), 'mira.mjs does not detect truncation');
});

test('TRUNCATION: the telemetry logs counters, never the reply', () => {
  const line = MIRA.split('\n').find((l) => l.includes('hit the token ceiling'));
  assert.ok(line, 'no truncation telemetry line found');
  assert.ok(!/\$\{reply\}/.test(line), 'the truncation log interpolates the reply itself');
  assert.ok(line.includes('reply.length'), 'the truncation log should record length, not content');
});

test('COUNTERFACTUAL: llm.mjs really did discard finish_reason at the pinned commit', () => {
  const before = fileAt(PRE_FIX_SHA, 'apps/engine/src/llm.mjs');
  if (before === null) return;
  assert.ok(
    !before.includes('finish_reason'),
    `expected finish_reason to be absent at ${PRE_FIX_SHA}; if it is present the pin is wrong`,
  );
});

test('CAPABILITY: the build line is additive and did not overwrite the jury text', () => {
  // The durable-memory paragraph is a jury verdict - it exists because Mira repeatedly told
  // customers she would forget them. Any "capability refresh" that drops it is a regression.
  assert.ok(
    MIRA.includes('DURABLE, PRIVATE MEMORY of this customer'),
    'the jury-fixed durable-memory paragraph was removed from CAPABILITY_AWARENESS',
  );
  assert.ok(MIRA.includes('BUILD_CAPABILITY_MARKER'), 'no build-capability marker');
  assert.ok(MIRA.includes('BUILD REAL, WORKING SOFTWARE'), 'no build capability text');
});

test('CAPABILITY: a build is only ever advertised when the backend is actually present', () => {
  // buildBackendAvailable() is call-time on purpose (it stats the bridge on every call), so the
  // injection must be call-time too. Advertising a build we cannot perform is worse than silence.
  const line = MIRA.split('\n').find((l) => l.includes('sys += BUILD_CAPABILITY'));
  assert.ok(line, 'BUILD_CAPABILITY is never injected into the system prompt');
  assert.ok(
    line.includes('buildBackendAvailable()'),
    'the build line is injected without checking that the backend exists',
  );
});
'''

for name, body in (('build-request-routing.test.mjs', ROUTING),
                   ('reply-privacy-and-budget.test.mjs', PRIVACY)):
    p = os.path.join(TESTDIR, name)
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(body)
    print('wrote %s (%d bytes)' % (p, len(body)))
