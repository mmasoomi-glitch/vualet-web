# -*- coding: utf-8 -*-
"""Wire the patched autopilot Stop hook back into settings.json.

Idempotent, backed up, and it REFUSES to proceed unless the hook file on disk
is the exact reviewed build. Run it as the owner; it writes under ~/.claude,
which agents are correctly forbidden to touch.
"""
import datetime
import hashlib
import io
import json
import os
import shutil
import sys

CLAUDE = os.path.join(os.path.expanduser("~"), ".claude")
SETTINGS = os.path.join(CLAUDE, "settings.json")
HOOK = os.path.join(CLAUDE, "hooks", "autopilot-jury-stop.py")
IDENTITY = os.path.join(CLAUDE, "hooks", "project_identity.py")
DISABLED = os.path.join(CLAUDE, "autopilot", "DISABLED")

EXPECTED_HOOK_SHA = "87d2007f3ed0bf60"        # reviewed + 18/18 tests
EXPECTED_IDENTITY_SHA = "47e005e1ffee5639"    # installed and judged earlier

COMMAND = 'python "C:\\Users\\Magic\\.claude\\hooks\\autopilot-jury-stop.py"'


def sha16(path):
    with io.open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()[:16]


def fail(msg):
    print("REFUSED: %s" % msg)
    sys.exit(1)


# --- preflight: never wire a file we did not review ------------------------
for path, expected, label in ((HOOK, EXPECTED_HOOK_SHA, "autopilot-jury-stop.py"),
                              (IDENTITY, EXPECTED_IDENTITY_SHA, "project_identity.py")):
    if not os.path.isfile(path):
        fail("%s is missing at %s" % (label, path))
    got = sha16(path)
    if got != expected:
        fail("%s hashes %s, expected %s - that is not the reviewed build"
             % (label, got, expected))
    print("verified %-26s %s" % (label, got))

# The patched hook must import cleanly BEFORE it is ever wired, or every
# session on this machine starts failing its Stop hook at once.
import py_compile  # noqa: E402
try:
    py_compile.compile(HOOK, doraise=True)
    py_compile.compile(IDENTITY, doraise=True)
    print("both files compile")
except py_compile.PyCompileError as exc:
    fail("compile failed: %s" % exc)

# --- back up settings.json -------------------------------------------------
stamp = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
backup = SETTINGS + ".bak-rewire-" + stamp
shutil.copy2(SETTINGS, backup)
print("backed up settings.json -> %s" % backup)

with io.open(SETTINGS, "r", encoding="utf-8") as fh:
    cfg = json.load(fh)

hooks = cfg.setdefault("hooks", {})
stop = hooks.setdefault("Stop", [])

# --- idempotent: do not add a second copy ---------------------------------
already = any(
    "autopilot-jury-stop.py" in (entry.get("command") or "")
    for block in stop if isinstance(block, dict)
    for entry in block.get("hooks", []) if isinstance(entry, dict)
)
if already:
    print("autopilot-jury-stop.py is ALREADY wired; leaving settings.json alone")
else:
    stop.append({"hooks": [{"type": "command", "command": COMMAND, "timeout": 60}]})
    with io.open(SETTINGS, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print("wired autopilot-jury-stop.py into hooks.Stop")

# --- lift the kill switch --------------------------------------------------
if os.path.isfile(DISABLED):
    os.remove(DISABLED)
    print("removed the kill switch %s - autopilot is now LIVE" % DISABLED)
else:
    print("no kill switch present; autopilot was already enabled")

# --- report the resulting state -------------------------------------------
with io.open(SETTINGS, "r", encoding="utf-8") as fh:
    final = json.load(fh)
print()
print("ACTIVE Stop hooks now, in order:")
for block in final.get("hooks", {}).get("Stop", []):
    for entry in block.get("hooks", []):
        print("   %s" % entry.get("command"))
print()
print("To undo everything:")
print('   copy "%s" "%s"' % (backup, SETTINGS))
print('   New-Item -ItemType File "%s"' % DISABLED)
