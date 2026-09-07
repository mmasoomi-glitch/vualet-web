# -*- coding: utf-8 -*-
import sqlite3
import sys

sys.path.insert(0, r"C:\Users\Magic\Desktop\env\mira-ledger")
import ledger  # noqa: E402

DB = r"C:\Users\Magic\Desktop\env\mira-ledger\ledger.db"


def newest(t):
    c = sqlite3.connect("file:" + DB.replace("\\", "/") + "?mode=ro", uri=True, timeout=5)
    try:
        return c.execute("SELECT MAX(id) FROM " + t).fetchone()[0]
    finally:
        c.close()


ledger.add_verification(
    project="claude-governance", date="2026-09-02",
    claim=(
        "THE PROJECT-DRIFT DEFECT IS CLOSED AND THE AUTOPILOT STOP HOOK IS LIVE AGAIN. "
        "gotchas#658 recorded that autopilot-jury-stop.py inferred a session's project "
        "from the agent's OWN LAST MESSAGE, so one passing mention of another product "
        "hijacked whole sessions - three times in one day. The hook had been removed "
        "from settings.json as mitigation. It is now REWIRED, with identification "
        "delegated to an explicit per-repository binding file and single-message text "
        "matching DELETED, not softened."
    ),
    method=(
        "Integration patch authored by moonshotai/kimi-k3 (kimi MCP, $0.1351) against "
        "the verbatim contract of the live hook, applied in BINARY MODE with every "
        "anchor asserted unique (a prior text-mode round trip on a file in this system "
        "silently converted 2,145 line endings), then tested by execution against the "
        "REAL canonical ledger, then installed by a hash-guarded installer that refuses "
        "to wire anything that is not the reviewed build. Owner authorised the write to "
        "the protected ~/.claude location in-turn; no governance guard was disabled."
    ),
    result="pass",
    tested_against="C:\\Users\\Magic\\.claude\\hooks\\autopilot-jury-stop.py sha256 prefix 87d2007f3ed0bf60; project_identity.py 47e005e1ffee5639",
    evidence=(
        "18 of 18 adversarial tests pass. THE DECISIVE ONE - THE HIJACK TEST: a last "
        "message stuffed five times over with 'the complete Kimi K3 handover for MiraVPN "
        "and FileHub, see vualet.com and the veridian memory system', run with a cwd "
        "bound to ballerina, STILL resolved to ballerina. The text is not consulted at "
        "all. Under the old code that same string selected project 33. "
        "FULL MATRIX: BOUND returns a dict carrying ballerina's real recorded "
        "next_action; INVALID returns the INVALID_BINDING sentinel and main() allows the "
        "stop BEFORE the marker scan and BEFORE the budget counter increments, so a "
        "misconfiguration can never consume budget; UNBOUND returns NO_MATCH, which is "
        "not a dict and therefore structurally cannot quote any task; a missing cwd "
        "returns NO_MATCH and os.getcwd() is NOT substituted. "
        "TRUTHFULNESS OF THE THREE-WAY CONTRACT PROVEN SEPARATELY: build_reason quotes "
        "next_action only for the dict form, quotes no task for NO_MATCH, does not "
        "falsely claim 'unreadable' for NO_MATCH, and says 'unreadable' only for None. "
        "FAIL-OPEN PROVEN TWICE by fault injection: with the identification module "
        "unavailable it returns None and does NOT resurrect text matching; with "
        "identification raising, it returns None rather than propagating. "
        "POST-INSTALL, the installed hook was invoked exactly as the harness invokes it, "
        "with a real payload and transcript: exit 0, no stdout, stop correctly allowed "
        "for owner-only work. ledger-stop-guard.py runs alongside it, exit 0. "
        "DELETIONS VERIFIED SAFE BEFORE REMOVAL by three greps: no other file in hooks/ "
        "references project_from_cwd, project_from_text, _norm_token or MIN_TEXT_KEY, "
        "and nothing loads this hook via importlib or runpy. "
        "ROLLBACK: settings.json.bak-rewire-20260902T033935Z, and "
        "hooks/autopilot-jury-stop.py.bak-predrift."
    ),
)
V = newest("verifications")

ledger.add_gotcha(
    project="claude-governance", date="2026-09-02",
    area="autopilot / rollout safety of the binding mechanism",
    symptom=(
        "The binding fix was switched on while FIVE projects were running "
        "simultaneously and only ONE of them had a binding file. The obvious fear is "
        "that the four unbound projects would be misidentified at the moment of "
        "cutover - the exact failure the fix exists to prevent."
    ),
    root_cause=(
        "The fear is unfounded, for a STRUCTURAL reason worth recording because it is "
        "not obvious from reading the patch. Of the four identification statuses, only "
        "BOUND maps to a dict, and only a dict lets build_reason quote a project's "
        "next_action. FALLBACK and NONE BOTH map to the sentinel NO_MATCH, which is "
        "already defined as 'identified nothing, generic wording, quote no task'. So "
        "for any repository WITHOUT a binding file the hook is structurally incapable "
        "of quoting any project's recorded task, no matter what the prevalence count "
        "returns. The degradation for unbound repos is strictly one-directional: toward "
        "LESS specificity, never toward WRONG specificity."
    ),
    fix=(
        "No staging was required and none was used. UNBOUND IS THE SAFE MODE, so there "
        "is no urgency to bind the remaining repositories; each one opts in to quoted "
        "tasks the moment its own .autopilot-project file lands, which makes the "
        "rollout inherently staged and self-healing. "
        "CORRECTION TO AN ASSUMPTION MADE DURING THIS WORK: the kill-switch file "
        "~/.claude/autopilot/DISABLED was described as a staging mechanism. It is not - "
        "it is a GLOBAL switch and cannot stage per project. The binding files are the "
        "staging mechanism. "
        "STANDING RULE: before binding a repository, verify the project's recorded "
        "next_action actually describes THAT repository. The owner bound C:\\vualet-web "
        "to key 'vualet'; it resolved BOUND correctly and then quoted 'Continue Stage 1: "
        "src/graph.ts + mocked-fetch tests' into a Next.js src/app tree containing no "
        "graph.ts - the identical string that derailed the VPN session. The binding was "
        "deleted. A binding guarantees the right PROJECT; only a fresh ledger row "
        "guarantees a right INSTRUCTION."
    ),
    evidence=(
        "verifications#%d. Hijack test and full status matrix, 18/18. The vualet "
        "binding's wrong-instruction output was observed directly before deletion."
        % V
    ),
    confidence="verified",
)

print("verifications#%d  autopilot rewired and live" % V)
print("gotchas#%d        unbound is the safe mode" % newest("gotchas"))
