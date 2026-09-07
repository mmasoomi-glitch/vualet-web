# -*- coding: utf-8 -*-
"""Retarget three static tripwires at the shipped pairing wizard.

These tests guard a jury mandate (wf_bf8978ef gate C2): observation must be
OPT-IN and DEFAULT-OFF, must not gate activation, and the real checkbox state
must be posted. The MANDATE is intact in the shipped code - verified directly:

    function requiredTicked() {
      return cLinked.checked && cStandIn.checked && cBanRisk.checked;
    }
    ... observation: cObserve.checked

cObserve is absent from the gate and the POST carries the real state. What broke
is only the SELECTOR NAMES: the pairing page was rebuilt as a five-step wizard
and its inputs are cLinked/cObserve/cStandIn/cBanRisk, where the tripwires still
look for checkConsent() and c-linked/c-observe/c-standin/c-ban.

So this retargets the tripwires WITHOUT relaxing them. Every assertion survives,
and one is strengthened: the new version also asserts cObserve is rendered at
all, which the old version never checked - a wizard that silently dropped the
observation checkbox would previously have passed.

BINARY MODE: exact-match, each anchor asserted unique.
"""
import hashlib
import io
import os
import shutil

SRC = r"C:\Ballerina-Motasadea-V1\apps\engine\test\wa-observation-optout.test.mjs"

with io.open(SRC, "rb") as fh:
    src = fh.read()

before = hashlib.sha256(src).hexdigest()
eol = b"\r\n" if src.count(b"\r\n") else b"\n"


def swap(old, new, label):
    global src
    n = src.count(old)
    assert n == 1, "anchor %s found %d times, expected 1" % (label, n)
    src = src.replace(old, new, 1)


# ── 1. the consent gate ───────────────────────────────────────────────────────
OLD_GATE = eol.join([
    b"test('consent gate does NOT require the observation checkbox', () => {",
    b"  const m = src.match(/function checkConsent\\(\\)\\{[\\s\\S]*?\\n\\}/);",
    b"  assert.ok(m, 'checkConsent() must exist');",
    b"  assert.ok(!m[0].includes(\"c-observe\"), 'checkConsent must not reference c-observe');",
    b"  for (const required of ['c-linked', 'c-standin', 'c-ban']) {",
    b"    assert.ok(m[0].includes(required), `checkConsent must require ${required}`);",
    b"  }",
    b"});",
])
NEW_GATE = eol.join([
    b"test('consent gate does NOT require the observation checkbox', () => {",
    b"  // Retargeted 2026-09-02: the pairing page is now a five-step wizard whose",
    b"  // gate is requiredTicked() over cLinked/cStandIn/cBanRisk. The MANDATE is",
    b"  // unchanged - observation must never gate activation - only the selector",
    b"  // names moved. Assertions below are the originals plus one addition.",
    b"  const m = src.match(/function requiredTicked\\(\\)\\s*\\{[\\s\\S]*?\\n  \\}/);",
    b"  assert.ok(m, 'requiredTicked() must exist');",
    b"  assert.ok(!m[0].includes('cObserve'), 'the consent gate must not reference cObserve');",
    b"  for (const required of ['cLinked', 'cStandIn', 'cBanRisk']) {",
    b"    assert.ok(m[0].includes(required), `the consent gate must require ${required}`);",
    b"  }",
    b"  // STRENGTHENED: the old tripwire only checked that observation was absent",
    b"  // from the gate, so a page that dropped the checkbox entirely would have",
    b"  // passed while silently removing the customer's ability to opt in.",
    b"  assert.ok(/<input type=\"checkbox\" id=\"cObserve\">/.test(src),",
    b"    'the observation checkbox must still be rendered so it can be opted into');",
    b"});",
])
swap(OLD_GATE, NEW_GATE, "consent gate")

# ── 2. the POST payload ───────────────────────────────────────────────────────
OLD_POST = eol.join([
    b"  assert.ok(",
    b"    src.includes(\"observation:document.getElementById('c-observe').checked\"),",
    b"    'observation consent must come from the actual checkbox');",
])
NEW_POST = eol.join([
    b"  assert.ok(",
    b"    /observation:\\s*cObserve\\.checked/.test(src),",
    b"    'observation consent must come from the actual checkbox');",
])
swap(OLD_POST, NEW_POST, "post payload")

# ── 3. the disclosure label ───────────────────────────────────────────────────
OLD_LABEL = eol.join([
    b"  assert.ok(/Observation Number \\(Optional \xe2\x80\x94 off by default\\)/.test(src),",
    b"    'disclosure label must state optional/off-by-default');",
])
NEW_LABEL = eol.join([
    b"  // The wizard states this on the checkbox's own label rather than in a",
    b"  // separate heading. Same guarantee, asserted where it now lives: the",
    b"  // observation box must be visibly marked optional, and must start unticked",
    b"  // (an input with no `checked` attribute is off by default).",
    b"  const box = src.match(/<input type=\"checkbox\" id=\"cObserve\"[^>]*>/);",
    b"  assert.ok(box, 'the observation checkbox must exist');",
    b"  assert.ok(!/\\bchecked\\b/.test(box[0]),",
    b"    'the observation checkbox must be OFF by default');",
    b"  assert.ok(/id=\"cObserve\">[\\s\\S]{0,400}?optional/i.test(src),",
    b"    'the observation checkbox must be labelled optional');",
])
swap(OLD_LABEL, NEW_LABEL, "disclosure label")

backup = SRC + ".bak-tripwires"
if not os.path.exists(backup):
    shutil.copy2(SRC, backup)
with io.open(SRC, "wb") as fh:
    fh.write(src)

print("backup : %s" % backup)
print("before : %s" % before[:16])
print("after  : %s" % hashlib.sha256(src).hexdigest()[:16])
print("assertions in file: %d (was 9)" % src.count(b"assert.ok("))
