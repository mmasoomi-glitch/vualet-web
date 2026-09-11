# -*- coding: utf-8 -*-
"""Adversarial test of the patched hook's identification path.

Imports the PATCHED hook as a module (its main is __main__-guarded) and
exercises hydrate_ledger across every status, against the REAL ledger.
No network: hydrate_ledger never calls the jury.
"""
import importlib.util
import io
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "autopilot-jury-stop.PATCHED.py")

# project_identity lives in the real hooks dir; the patched copy adds ITS OWN
# directory to sys.path, so make the module importable from here too.
sys.path.insert(0, r"C:\Users\Magic\.claude\hooks")

spec = importlib.util.spec_from_file_location("patched_hook", HOOK)
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)

passed = failed = 0


def check(label, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("  PASS  %s" % label)
    else:
        failed += 1
        print("  FAIL  %s   %s" % (label, detail))


print("=== 0. the module imported project_identity at all ===")
check("_HAVE_PROJECT_IDENTITY is True", hook._HAVE_PROJECT_IDENTITY is True,
      "the import block failed - every result below would be a false negative")
check("the defective functions are gone",
      not hasattr(hook, "project_from_text") and not hasattr(hook, "project_from_cwd"))

# Build three throwaway repos.
BOUND = os.path.join(HERE, "t_bound")
INVALID = os.path.join(HERE, "t_invalid")
UNBOUND = os.path.join(HERE, "t_unbound")
for d in (BOUND, INVALID, UNBOUND):
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
io.open(os.path.join(BOUND, ".autopilot-project"), "w", encoding="utf-8").write("ballerina\n")
io.open(os.path.join(INVALID, ".autopilot-project"), "w", encoding="utf-8").write("no-such-project\n")
os.makedirs(os.path.join(UNBOUND, ".git"))  # repo root, no binding

print()
print("=== 1. BOUND -> dict, and it is the RIGHT project ===")
r = hook.hydrate_ledger("irrelevant text mentioning miravpn and filehub", BOUND, None)
check("returns a dict", isinstance(r, dict), repr(r)[:120])
if isinstance(r, dict):
    check("project is ballerina, NOT a project named in the text",
          "ballerina" in r.get("project", "").lower(), r.get("project"))
    check("next_action is populated", bool(r.get("next_action")))
    check("fields truncated to LEDGER_FIELD_CAP",
          all(len(r[k]) <= hook.LEDGER_FIELD_CAP for k in ("blockers", "next_action")))
    print("        project    : %s" % r.get("project"))
    print("        next_action: %s..." % r.get("next_action", "")[:90])

print()
print("=== 2. THE HIJACK TEST: text screams another project, cwd is bound ===")
hijack = ("Here is the complete Kimi K3 handover for MiraVPN and FileHub, "
          "see vualet.com and the veridian memory system for details.") * 5
r2 = hook.hydrate_ledger(hijack, BOUND, None)
check("STILL resolves to ballerina, text is ignored entirely",
      isinstance(r2, dict) and "ballerina" in r2.get("project", "").lower(),
      repr(r2)[:160])

print()
print("=== 3. INVALID -> the sentinel, never a dict, never silence ===")
r3 = hook.hydrate_ledger("anything", INVALID, None)
check('returns "INVALID_BINDING"', r3 == "INVALID_BINDING", repr(r3)[:120])

print()
print("=== 4. UNBOUND, no transcript -> NO_MATCH, never a quoted task ===")
r4 = hook.hydrate_ledger(hijack, UNBOUND, None)
check('returns "NO_MATCH"', r4 == "NO_MATCH", repr(r4)[:120])
check("is NOT a dict, so no next_action can be quoted", not isinstance(r4, dict))

print()
print("=== 5. missing cwd -> NO_MATCH, and os.getcwd() is NOT substituted ===")
r5 = hook.hydrate_ledger(hijack, None, None)
check('returns "NO_MATCH"', r5 == "NO_MATCH", repr(r5)[:120])

print()
print("=== 6. build_reason tells the TRUTH for each of the three values ===")
d = hook.hydrate_ledger("x", BOUND, None)
b_dict = hook.build_reason("test trigger", 1, 10, d)
b_nomatch = hook.build_reason("test trigger", 1, 10, "NO_MATCH")
b_none = hook.build_reason("test trigger", 1, 10, None)
check("dict form quotes the project's next_action",
      "ballerina" in b_dict.lower() and d["next_action"][:40] in b_dict)
check("NO_MATCH form quotes NO task",
      d["next_action"][:40] not in b_nomatch, b_nomatch[:160])
check("NO_MATCH does not falsely claim the ledger was unreadable",
      "unreadable" not in b_nomatch.lower(), b_nomatch[:160])
check("None form is the only one allowed to say unreadable",
      "unreadable" in b_none.lower(), b_none[:160])
check("every reason respects REASON_CAP",
      all(len(x) <= hook.REASON_CAP for x in (b_dict, b_nomatch, b_none)))

print()
print("=== 7. FAIL OPEN: identification module unavailable -> None ===")
saved = hook._HAVE_PROJECT_IDENTITY
try:
    hook._HAVE_PROJECT_IDENTITY = False
    check("returns None, and does NOT resurrect text matching",
          hook.hydrate_ledger(hijack, BOUND, None) is None)
finally:
    hook._HAVE_PROJECT_IDENTITY = saved

print()
print("=== 8. FAIL OPEN: identification raises -> None, no crash ===")
saved_fn = hook.identify_session_project
try:
    def boom(*a, **k):
        raise RuntimeError("simulated ledger explosion")
    hook.identify_session_project = boom
    check("returns None rather than propagating",
          hook.hydrate_ledger("x", BOUND, None) is None)
finally:
    hook.identify_session_project = saved_fn

for d_ in (BOUND, INVALID, UNBOUND):
    shutil.rmtree(d_, ignore_errors=True)

print()
print("RESULT: %d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
