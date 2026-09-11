# -*- coding: utf-8 -*-
"""Apply the kimi-authored integration patch to autopilot-jury-stop.py.

BINARY MODE THROUGHOUT. A text-mode round trip on this file previously
converted 2,145 line endings; the file is LF-only and must stay LF-only.
Every anchor is asserted to occur exactly once before it is used, so a
drifted file fails loudly instead of being silently mangled.
"""
import hashlib
import io
import os

P = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                 "autopilot-jury-stop.PATCHED.py")

with io.open(P, "rb") as fh:
    src = fh.read()

BEFORE_SHA = hashlib.sha256(src).hexdigest()
BEFORE_CRLF = src.count(b"\r\n")


def once(needle, label):
    n = src.count(needle)
    assert n == 1, "anchor %s found %d times, expected exactly 1" % (label, n)
    return src.index(needle)


# ---------------------------------------------------------------- span cut
# Delete MIN_TEXT_KEY / _norm_token / project_from_cwd / project_from_text
# AND the long comment block above them, which documents the removed design
# and is now actively false ("Text matching survives only as a fallback").
# Then drop the replacement hydrate_ledger in the same span.
mid = once(b"MIN_TEXT_KEY = 4", "MIN_TEXT_KEY")
# Walk back to the start of the contiguous comment block preceding it.
start = src.rfind(b"\n\n\n", 0, mid)
assert start != -1, "could not find the block boundary before MIN_TEXT_KEY"
start += 3  # keep the blank-line separator that precedes the block

end = once(b"def build_reason(trigger, count, cap, ledger):", "build_reason")

TOMBSTONE_AND_HYDRATE = b'''# PROJECT IDENTITY IS NO LONGER GUESSED HERE.
#
# What used to live at this point - MIN_TEXT_KEY, _norm_token,
# project_from_cwd and project_from_text - inferred the session's project
# from path shape and, failing that, from project names appearing in the
# agent's OWN LAST MESSAGE. One passing mention hijacked whole sessions:
# a Go/Python VPN repo was handed "Continue Stage 1: src/graph.ts +
# mocked-fetch tests" and began building the wrong product, three times in
# one day across three unrelated sessions (gotchas#658).
#
# Two earlier patches tried to make the guess safer rather than remove it -
# word boundaries plus a minimum key length after 'ain' matched inside
# "chain", "remaining" and "explain"; then cwd path-component matching after
# the USERNAME in a path matched a real project key. Both still leaked.
#
# A project is now TOLD, never inferred: project_identity.py resolves an
# explicit per-repository .autopilot-project binding file, and where none
# exists falls back to a prevalence count over the whole transcript that
# must clear a margin rule or stay silent. Do not reintroduce single-message
# text matching in any softened form.


def hydrate_ledger(text, cwd=None, transcript_path=None):
    """Identify the session's project and return its ledger context.

    Three-way contract consumed by build_reason (plus one internal sentinel
    intercepted by main before build_reason can see it):
      dict              -> BOUND; build_reason may quote next_action verbatim.
      "NO_MATCH"        -> FALLBACK or NONE with a readable ledger; generic
                           wording, quote NO task.
      None              -> identification module unavailable, identification
                           raised, or the ledger DB file is absent; only then
                           may build_reason say "unreadable".
      "INVALID_BINDING" -> INVALID; main() allows the stop immediately.

    `text` is retained in the signature for call-site compatibility but is
    deliberately UNUSED: the agent's own last message is no longer a source
    of project identity (that was the hijack defect).
    """

    def clean(value):
        if value is None:
            return ""
        value = str(value).strip()
        if len(value) > LEDGER_FIELD_CAP:
            value = value[:LEDGER_FIELD_CAP]
        return value

    if not _HAVE_PROJECT_IDENTITY or identify_session_project is None:
        # No identification module -> no ledger context at all. Never fall
        # back to guessing from the transcript text.
        return None

    if not cwd:
        # No cwd in the payload: we cannot identify anything, and the hook
        # process's own os.getcwd() says nothing about the session's
        # project, so it must NOT be substituted here.
        return "NO_MATCH"

    try:
        ident = identify_session_project(cwd, transcript_path)
    except Exception:
        # Identification itself failed (unreadable ledger, etc.). Fail open.
        return None

    if ident.status == IdentificationStatus.BOUND and ident.context is not None:
        ctx = ident.context
        return {
            "project": clean(ctx.name or ctx.key),
            "stage": clean(ctx.stage),
            "blockers": clean(ctx.blockers),
            "next_action": clean(ctx.next_action),
        }

    if ident.status == IdentificationStatus.INVALID:
        # A binding file exists but is malformed or names no real project.
        # Never treated as an absence; main() intercepts this sentinel.
        return "INVALID_BINDING"

    if ident.status == IdentificationStatus.NONE:
        # ASSUMPTION: the identification API merges "nothing identified" and
        # "ledger unreadable" into NONE with no discriminator. Use the ledger
        # DB file's presence as the best-effort test for "unreadable" so
        # build_reason never claims "unreadable" when the ledger was fine.
        try:
            if LEDGER_DB_PATH_PI and not os.path.isfile(LEDGER_DB_PATH_PI):
                return None
        except Exception:
            pass
        return "NO_MATCH"

    # FALLBACK (and any unknown future status): prevalence cleared the margin
    # but may NEVER quote a recorded task. "NO_MATCH" already carries exactly
    # that meaning: generic continuation wording, no quoted next_action.
    return "NO_MATCH"


'''

src = src[:start] + TOMBSTONE_AND_HYDRATE + src[end:]

# ------------------------------------------------------------------ import
IMPORT_ANCHOR = b"import tempfile\n"
assert src.count(IMPORT_ANCHOR) == 1, "import anchor not unique"
IMPORT_BLOCK = b'''import tempfile

# project_identity.py lives in the same directory as this hook, but a Stop
# hook is executed by absolute path and its directory is NOT guaranteed to be
# on sys.path. Add it explicitly. Fail open: if the module cannot be imported
# for ANY reason, the hook continues with no ledger context at all
# (hydrate_ledger returns None). It must NEVER fall back to the old
# last-message project-name scanning - that scanning is the defect this
# patch removes.
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
except Exception:
    # __file__ may be undefined if the file is exec'd rather than imported.
    pass

try:
    from project_identity import (
        identify_session_project,
        IdentificationStatus,
        LEDGER_DB_PATH as LEDGER_DB_PATH_PI,
    )
    _HAVE_PROJECT_IDENTITY = True
except Exception:
    # Broad except is deliberate: ImportError, a SyntaxError in the module,
    # or anything it raises at import time all mean the same thing here -
    # no identification available. Never crash the hook.
    identify_session_project = None
    IdentificationStatus = None
    LEDGER_DB_PATH_PI = None
    _HAVE_PROJECT_IDENTITY = False
'''
src = src.replace(IMPORT_ANCHOR, IMPORT_BLOCK, 1)

# --------------------------------------------------------------- call site
OLD_CALL = (b'    # cwd is the boundary. If the payload omits it, fall back to the\n'
            b'    # process working directory rather than to nothing.\n'
            b'    ledger = hydrate_ledger(text, payload.get("cwd") or os.getcwd())\n')
assert src.count(OLD_CALL) == 1, "call site not unique"
NEW_CALL = b'''    # cwd is the boundary, and there is no os.getcwd() fallback: the hook
    # process's own directory says nothing about the session's project.
    # A missing cwd yields "NO_MATCH" (generic wording, no quoted task).
    ledger = hydrate_ledger(
        text,
        payload.get("cwd"),
        payload.get("transcript_path"),
    )

    if ledger == "INVALID_BINDING":
        # A .autopilot-project binding exists but is malformed or names no
        # real ledger project. Allow the stop BEFORE the marker scan and
        # BEFORE the budget counter increments: a misconfiguration must never
        # consume budget and must never be treated as an absence of binding.
        # stdout is the hook protocol channel, so this goes to stderr.
        try:
            sys.stderr.write(
                "autopilot-jury-stop: .autopilot-project binding is "
                "malformed or names no real ledger project; allowing stop. "
                "Fix or delete the binding file in this repo.\\n"
            )
        except Exception:
            pass
        allow()
'''
src = src.replace(OLD_CALL, NEW_CALL, 1)

# ------------------------------------------------------------------- write
with io.open(P, "wb") as fh:
    fh.write(src)

print("before sha256 : %s" % BEFORE_SHA[:16])
print("after  sha256 : %s" % hashlib.sha256(src).hexdigest()[:16])
print("CRLF before %d, after %d  (must both be 0)" % (BEFORE_CRLF, src.count(b"\r\n")))
print("bytes: %d" % len(src))
for gone in (b"MIN_TEXT_KEY", b"def _norm_token", b"def project_from_cwd", b"def project_from_text"):
    print("  removed %-24s : %s" % (gone.decode(), src.count(gone) == 0))
for need in (b"identify_session_project", b"INVALID_BINDING", b"_HAVE_PROJECT_IDENTITY"):
    print("  present %-24s : %d" % (need.decode(), src.count(need)))
