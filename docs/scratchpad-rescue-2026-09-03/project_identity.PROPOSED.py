"""
project_identity.py -- project-identification layer for the autopilot Stop hook.

STATUS: PROPOSED. Authored by moonshotai/kimi-k3 (session kimi_d502c20ae821),
2026-09-01. NOT WIRED INTO settings.json. Review before installing.

Replaces the defective cwd/text guessing (project_from_cwd / project_from_text)
with two mechanisms, in strict precedence order:

  1. BINDING: an explicit per-repository marker file, found by walking up from
     the session cwd, stopping at the innermost repository boundary.
  2. FALLBACK (only when UNBOUND): a prevalence signal over the WHOLE session
     transcript, with a margin rule that produces silence on any narrow lead.

Design invariants enforced here:
  * FAIL OPEN: any exception anywhere lets the agent stop.
  * The ledger is opened read-only (SQLite URI mode=ro) and never written.
  * Prevalence NEVER overrides an explicit binding.
  * The fallback NEVER quotes next_action; only a generic continuation.
  * A missing cwd is UNBOUND; os.getcwd() is never used as a substitute.

Python 3.8+, standard library only.
"""

import json
import os
import re
import sqlite3
import sys
from collections import defaultdict
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

# --------------------------------------------------------------------------
# Named constants. Every threshold carries the reason for its specific value.
# --------------------------------------------------------------------------

# ASSUMPTION: the dossier fixes the ledger location as "a fixed absolute path"
# but does not state it. Set this constant to the real deployment path; the
# environment override exists so tests can point at a scratch database.
LEDGER_DB_PATH = os.environ.get(
    "AUTOPILOT_LEDGER_DB",
    r"C:\Users\Magic\Desktop\env\mira-ledger\ledger.db")

# One hidden, self-describing filename. A single-line plain-text file was chosen
# over JSON/YAML because there is exactly one datum, there is nothing to
# mis-nest, and `type .autopilot-project` / `cat` answers a human instantly.
BINDING_FILENAME = ".autopilot-project"

# A binding is one short line. The cap exists so a garbage or hostile file
# (e.g. the agent accidentally redirecting a build log here) cannot make the
# hook read unbounded bytes inside its 60-second budget.
MAX_BINDING_BYTES = 4096

# The ledger query touches a 42-row table and one indexed state lookup:
# milliseconds in the worst case. 5 s bounds a locked or AV-scanned file
# without putting a meaningful dent in the 60 s hook budget.
SQLITE_TIMEOUT_SECONDS = 5.0

# Keys of 1-3 characters are unmatchable in prose: the key 'ain' fired inside
# "chain", "remaining" and "explain". Such projects remain reachable via the
# binding file; they simply cannot participate in prevalence.
MIN_KEY_LENGTH = 4

# MARGIN RULE (the crux). All three conditions must hold or the verdict is
# SILENCE:
#   * MIN_LEADER_MENTIONS = 5: the observed failures were 1-2 stray mentions in
#     an entire session. A session genuinely about a project names it in many
#     messages (human requests plus assistant narration). 5 is far above
#     stray-mention noise and trivially reached by real work.
#   * MIN_ABSOLUTE_LEAD = 3: with one vote per project per message, a 3-message
#     gap means sustained dominance, and makes ties or one-message differences
#     structurally silent.
#   * MIN_LEAD_RATIO = 2.0: the leader must double the runner-up, so even a
#     cluster of coordinated cross-references (a handover summary listing
#     other projects) stays under half the leader's support.
MIN_LEADER_MENTIONS = 5
MIN_ABSOLUTE_LEAD = 3
MIN_LEAD_RATIO = 2.0

# Ledger keys are slugs; '#' can never be part of one, so it is safe to treat
# as a comment starter in the binding file.
_KEY_SHAPE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")

# The fallback's ONLY payload. It names no project and quotes no ledger task,
# so a wrong prevalence verdict cannot inject foreign work into a session --
# the exact harm in observed failure (c).
GENERIC_CONTINUATION = (
    "Autopilot: your last message indicated unfinished work, but no explicit "
    "project binding exists and the session-wide signal only weakly favours "
    "one project. Continue the work you were already doing in THIS session. "
    "Do not switch projects and do not start unrelated tasks."
)


# --------------------------------------------------------------------------
# Result types
# --------------------------------------------------------------------------

class BindingStatus(Enum):
    BOUND = "bound"        # explicit binding found and validated
    UNBOUND = "unbound"    # nothing found anywhere up the tree; normal; quiet
    INVALID = "invalid"    # a file exists but is malformed or names no ledger project


@dataclass(frozen=True)
class BindingResult:
    status: BindingStatus
    project_key: str = None      # canonical ledger key, set when BOUND
    binding_path: str = None     # absolute path of the file, set when one was found
    detail: str = ""             # human-readable reason, set when INVALID


@dataclass(frozen=True)
class LedgerContext:
    project_id: int
    key: str
    name: str
    stage: str
    blockers: str
    next_action: str


@dataclass(frozen=True)
class PrevalenceResult:
    project_id: int
    mentions: int
    runner_up_mentions: int


class IdentificationStatus(Enum):
    BOUND = "bound"        # ledger context may be used and quoted
    FALLBACK = "fallback"  # prevalence verdict; generic continuation ONLY
    INVALID = "invalid"    # loud misconfiguration; allow the stop
    NONE = "none"          # no evidence at all; allow the stop


@dataclass(frozen=True)
class Identification:
    status: IdentificationStatus
    context: LedgerContext = None   # populated ONLY when BOUND
    binding_path: str = None
    project_key: str = None         # set whenever a binding resolved BOUND
    detail: str = ""
    mentions: int = 0
    runner_up_mentions: int = 0


# --------------------------------------------------------------------------
# (A) The binding resolver
# --------------------------------------------------------------------------

def _iter_directories_upward(start):
    """Yield start, then each parent, ending at the filesystem root.

    os.path.dirname terminates correctly on drive-letter roots ('C:\\'),
    UNC roots ('\\\\server\\share') and POSIX '/': each is its own parent.
    """
    current = os.path.abspath(start)
    seen = set()
    while True:
        # normcase lowercases and normalises separators on Windows, so a
        # junction/symlink loop is detected case-insensitively there and
        # harmlessly (identity) on POSIX.
        marker = os.path.normcase(current)
        if marker in seen:
            return
        seen.add(marker)
        yield current
        parent = os.path.dirname(current)
        if parent == current or not parent:
            return
        current = parent


def _has_repo_boundary(dirpath):
    """True if dirpath is a repository root.

    .git is a DIRECTORY for a normal checkout but a FILE for worktrees and
    submodules; both forms must stop the walk.
    """
    git = os.path.join(dirpath, ".git")
    try:
        return os.path.isdir(git) or os.path.isfile(git)
    except OSError:
        return False


def _read_binding_file(path):
    """Parse a binding file. Returns (key, None) or (None, error_message).

    Format: UTF-8, one ledger project key on a single logical line.
      * A UTF-8 BOM is stripped (Windows editors add one silently).
      * splitlines() makes CRLF vs LF vs bare CR irrelevant.
      * Blank lines and everything from '#' to end-of-line are ignored, so
        humans may annotate the file; keys are slugs and never contain '#'.
      * Surrounding whitespace on the key line is ignored.
      * Anything else -- empty file, several keys, non-slug characters -- is
        INVALID, never silently UNBOUND.
    """
    try:
        with open(path, "rb") as fh:
            raw = fh.read(MAX_BINDING_BYTES + 1)
    except OSError as exc:
        return None, "unreadable: %s" % exc
    if len(raw) > MAX_BINDING_BYTES:
        return None, "exceeds %d bytes; a binding is one short line" % MAX_BINDING_BYTES
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        return None, "not valid UTF-8: %s" % exc
    entries = []
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            entries.append(line)
    if not entries:
        return None, "file is empty or contains only comments"
    if len(entries) > 1:
        return None, "contains %d candidate keys; exactly one is required" % len(entries)
    key = entries[0].lower()
    if not _KEY_SHAPE.match(key):
        return None, "not a plausible ledger key: %r" % entries[0]
    return key, None


def resolve_project_binding(cwd, valid_keys=None):
    """Walk from cwd to the filesystem root looking for BINDING_FILENAME.

    Stops at the first binding file found, OR at the innermost repository
    boundary (.git), whichever comes first. The boundary stop is essential:
    without it a binding in a parent folder (e.g. a 'projects' directory)
    would capture every unrelated sibling checkout beneath it.

    valid_keys is the set of ledger keys used to distinguish BOUND from
    INVALID. If omitted, it is loaded from the ledger (may raise; callers
    fail open). A missing or blank cwd is UNBOUND -- os.getcwd() is never
    substituted, because the process's own directory says nothing about the
    session's project.
    """
    if not cwd or not str(cwd).strip():
        return BindingResult(BindingStatus.UNBOUND, detail="no cwd supplied")
    if valid_keys is None:
        valid_keys = load_project_keys()
    # Case-insensitive comparison only. Separators are NOT folded: 'miravpn'
    # and 'mira-vpn' are distinct rows in the projects table, and the old
    # normaliser's habit of merging them is part of the defect being removed.
    canonical = {k.lower(): k for k in valid_keys if isinstance(k, str)}
    try:
        start = str(cwd)
        if not os.path.isdir(start):
            return BindingResult(BindingStatus.UNBOUND,
                                 detail="cwd is not an existing directory: %r" % start)
        for dirpath in _iter_directories_upward(start):
            candidate = os.path.join(dirpath, BINDING_FILENAME)
            try:
                found = os.path.isfile(candidate)
            except OSError:
                found = False
            if found:
                key, error = _read_binding_file(candidate)
                if error is not None:
                    return BindingResult(BindingStatus.INVALID,
                                         binding_path=candidate, detail=error)
                canonical_key = canonical.get(key)
                if canonical_key is None:
                    return BindingResult(
                        BindingStatus.INVALID, binding_path=candidate,
                        detail="names project %r, which is absent from the "
                               "projects table" % key)
                return BindingResult(BindingStatus.BOUND,
                                     project_key=canonical_key,
                                     binding_path=candidate)
            if _has_repo_boundary(dirpath):
                return BindingResult(
                    BindingStatus.UNBOUND,
                    detail="repository root reached without a binding")
        return BindingResult(BindingStatus.UNBOUND,
                             detail="filesystem root reached without a binding")
    except OSError as exc:
        # A walk that cannot proceed (permissions, vanished mount) is not
        # evidence of anything; UNBOUND keeps it quiet and lets the fallback try.
        return BindingResult(BindingStatus.UNBOUND, detail="walk failed: %s" % exc)


# --------------------------------------------------------------------------
# (B) Read-only ledger access
# --------------------------------------------------------------------------

def _connect_read_only(db_path):
    """Open the ledger strictly read-only.

    mode=ro makes SQLite itself refuse writes; PRAGMA query_only is a second
    fence so that even a URI mistake cannot turn this hook into a writer.
    pathlib.as_uri() produces a correct file: URI for drive-letter, UNC and
    POSIX paths, including spaces.
    """
    uri = Path(os.path.abspath(db_path)).as_uri() + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=SQLITE_TIMEOUT_SECONDS)
    conn.execute("PRAGMA query_only = ON")
    return conn


def load_projects(db_path=LEDGER_DB_PATH):
    """Return [(id, key, name), ...] for every project. Read-only."""
    conn = _connect_read_only(db_path)
    try:
        rows = conn.execute("SELECT id, key, name FROM projects").fetchall()
    finally:
        conn.close()
    return [(int(r[0]), r[1], r[2]) for r in rows]


def load_project_keys(db_path=LEDGER_DB_PATH):
    return [key for _pid, key, _name in load_projects(db_path)]


def load_next_action(project_key, db_path=LEDGER_DB_PATH):
    """Newest state row for project_key, or None.

    Exact key match: the binding resolver has already canonicalised case, and
    no fuzzy folding is permitted because near-identical keys ('miravpn' vs
    'mira-vpn') are distinct projects.
    """
    conn = _connect_read_only(db_path)
    try:
        prow = conn.execute(
            "SELECT id, key, name FROM projects WHERE key = ?",
            (project_key,)).fetchone()
        if prow is None:
            return None
        srow = conn.execute(
            "SELECT stage, blockers, next_action FROM state "
            "WHERE project_id = ? ORDER BY id DESC LIMIT 1",
            (prow[0],)).fetchone()
        if srow is None:
            return None
        return LedgerContext(project_id=int(prow[0]), key=prow[1],
                             name=prow[2] or "", stage=srow[0],
                             blockers=srow[1], next_action=srow[2])
    finally:
        conn.close()


# --------------------------------------------------------------------------
# (C) The prevalence signal over the whole transcript
# --------------------------------------------------------------------------

def _build_matchers(projects):
    """Build {match_variant: project_id}, dropping anything ambiguous.

    Each project contributes its key and its name, plus a 'squashed' form
    with separators removed (so 'mira-vpn' also matches the prose 'MiraVPN').
    A variant claimed by more than one project is dropped for ALL of them:
    concretely, the ledger holds both 'miravpn' and 'mira-vpn', whose squashed
    forms collide, so neither project may score on that string. Only a binding
    file can disambiguate such pairs -- that is deliberate.
    """
    claims = defaultdict(set)
    for pid, key, name in projects:
        for candidate in (key, name):
            if not isinstance(candidate, str):
                continue
            base = candidate.strip().lower()
            if len(base) < MIN_KEY_LENGTH:
                continue
            for variant in {base, re.sub(r"[-_ ]+", "", base)}:
                if len(variant) >= MIN_KEY_LENGTH:
                    claims[variant].add(pid)
    return {v: next(iter(pids)) for v, pids in claims.items() if len(pids) == 1}


def _compile_pattern(variants):
    """One regex for all variants.

    Boundary classes exclude [a-z0-9._-] before and [a-z0-9_-] after, so a
    key cannot fire inside ordinary words ('chain'), compound tokens, or
    longer hyphenated names. A trailing '.' is allowed (sentence end) and
    filtered separately in _iter_mentions, because 'vualet.com' must not
    count but 'I worked on mira-vpn.' must.
    Longest-first alternation so 'mira-vpn' is tried before 'mira'.
    """
    body = "|".join(sorted((re.escape(v) for v in variants),
                           key=len, reverse=True))
    return re.compile(r"(?<![a-z0-9._-])(?:" + body + r")(?![a-z0-9_-])")


def _iter_mentions(pattern, lowered_text):
    for match in pattern.finditer(lowered_text):
        end = match.end()
        # Domain / file-extension context: 'vualet.com' or 'x.ts'. A dot
        # followed by a letter means the token is part of a dotted name, not
        # a prose mention. A dot followed by space/end is a sentence stop.
        if end + 1 < len(lowered_text) and lowered_text[end] == "." \
                and lowered_text[end + 1].isalpha():
            continue
        yield match.group(0)


def _extract_message_text(record):
    """Return the human- or agent-written text of a transcript record, or None.

    ASSUMPTION: the dossier does not fix the transcript schema beyond 'one
    JSON object per line; assistant messages carry the agent's own text'. The
    common shapes ('type' or 'role'; content as a plain string or as a list
    of typed blocks) are handled; unrecognised shapes contribute nothing,
    which is safe because prevalence is itself only a fallback.

    Only 'text' blocks count. tool_use / tool_result content is deliberately
    excluded: tool output quotes file contents and command output in bulk,
    and one grep of a vendored file would flood the count with incidental
    project names.
    """
    if not isinstance(record, dict):
        return None
    role = record.get("type") or record.get("role")
    if role not in ("user", "assistant"):
        return None
    content = record.get("content")
    if content is None and isinstance(record.get("message"), dict):
        content = record["message"].get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [b["text"] for b in content
                 if isinstance(b, dict) and b.get("type") == "text"
                 and isinstance(b.get("text"), str)]
        return "\n".join(parts) if parts else None
    return None


def project_from_transcript(projects, transcript_path):
    """Prevalence verdict over the WHOLE transcript, or None (silence).

    Window: the entire file. A transcript is one session, so there is no
    cross-session staleness to bound, and the longest window maximally
    dilutes any single mention. Measured cost (0.09 s for 45 MB against a
    60 s budget) makes window size a pure design choice.

    Weighting: none. Every message votes equally; recency weighting would
    re-create the single-message defect in miniature by letting the last
    message dominate.

    Voting: one vote per project per message, so a single verbose message
    listing a project forty times cannot stuff the ballot.

    Margin: leader must reach MIN_LEADER_MENTIONS, lead by MIN_ABSOLUTE_LEAD,
    and hold a MIN_LEAD_RATIO advantage. Anything less -- including an exact
    tie -- returns None. Silence, never a coin flip.
    """
    if not transcript_path or not projects:
        return None
    matchers = _build_matchers(projects)
    if not matchers:
        return None
    pattern = _compile_pattern(matchers)
    votes = defaultdict(int)
    try:
        # errors='replace': corrupt bytes must never raise inside the hook.
        fh = open(transcript_path, "r", encoding="utf-8", errors="replace")
    except OSError:
        return None
    with fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except ValueError:
                continue  # malformed or truncated JSONL: skip, never raise
            text = _extract_message_text(record)
            if not text:
                continue
            lowered = text.lower()
            seen_in_record = set()
            for variant in _iter_mentions(pattern, lowered):
                pid = matchers.get(variant)
                if pid is not None:
                    seen_in_record.add(pid)
            for pid in seen_in_record:
                votes[pid] += 1
    if not votes:
        return None
    ranking = sorted(votes.items(), key=lambda kv: kv[1], reverse=True)
    leader, leader_n = ranking[0]
    runner_n = ranking[1][1] if len(ranking) > 1 else 0
    if leader_n < MIN_LEADER_MENTIONS:
        return None
    if leader_n - runner_n < MIN_ABSOLUTE_LEAD:
        return None
    if runner_n > 0 and leader_n < MIN_LEAD_RATIO * runner_n:
        return None
    return PrevalenceResult(project_id=leader, mentions=leader_n,
                            runner_up_mentions=runner_n)


# --------------------------------------------------------------------------
# (D) The revised decision flow (replaces the old hydrate_ledger call site)
# --------------------------------------------------------------------------

def _surface_invalid(binding):
    """INVALID must be seen by a human. stdout is reserved for the JSON stop
    decision, so stderr -- the channel the tool surfaces from hooks -- is the
    loud path. INVALID never forces a continuation."""
    try:
        print("AUTOPILOT MISCONFIGURATION: %s exists but is invalid (%s). "
              "Fix or delete the file; the agent was allowed to stop."
              % (binding.binding_path, binding.detail), file=sys.stderr)
    except Exception:
        pass  # even the alarm must not break the hook


def identify_session_project(cwd, transcript_path, db_path=LEDGER_DB_PATH):
    """The identification layer's single entry point.

    Precedence is structural: the binding is resolved first and RETURNS
    before the fallback runs, so prevalence can never override an explicit
    binding. Every failure path degrades toward NONE (allow the stop).
    """
    try:
        projects = load_projects(db_path)
    except Exception:
        # Without the ledger nothing can be validated or scored. Fail open.
        return Identification(IdentificationStatus.NONE,
                              detail="ledger unreadable")
    valid_keys = [k for _pid, k, _n in projects]
    try:
        binding = resolve_project_binding(cwd, valid_keys=valid_keys)
    except Exception as exc:
        return Identification(IdentificationStatus.NONE,
                              detail="binding resolution failed: %s" % exc)

    if binding.status is BindingStatus.BOUND:
        try:
            context = load_next_action(binding.project_key, db_path)
        except Exception:
            context = None  # bound but ledger row missing: generic continue
        return Identification(IdentificationStatus.BOUND, context=context,
                              binding_path=binding.binding_path,
                              project_key=binding.project_key,
                              detail="bound via %s" % binding.binding_path)

    if binding.status is BindingStatus.INVALID:
        _surface_invalid(binding)
        return Identification(IdentificationStatus.INVALID,
                              binding_path=binding.binding_path,
                              detail=binding.detail)

    # UNBOUND: the prevalence fallback, and nothing else.
    try:
        verdict = project_from_transcript(projects, transcript_path)
    except Exception:
        verdict = None
    if verdict is None:
        # Ruling: inconclusive evidence means ALLOW THE STOP. Blocking with
        # zero evidence manufactures work and would be rescued only by the
        # continuation-budget rail; silence is the fail-open default. The
        # observed harm came from speaking without warrant, not from silence.
        return Identification(IdentificationStatus.NONE,
                              detail=binding.detail or
                              "unbound and prevalence inconclusive")
    # NOTE: context is deliberately None. The fallback may not quote
    # next_action, so the ledger row is not even loaded on this path.
    return Identification(IdentificationStatus.FALLBACK, context=None,
                          detail="prevalence verdict (%d mentions, runner-up %d); "
                                 "generic continuation only"
                                 % (verdict.mentions, verdict.runner_up_mentions),
                          mentions=verdict.mentions,
                          runner_up_mentions=verdict.runner_up_mentions)


def continuation_instruction(ident):
    """Map an Identification to the instruction text for a block decision,
    or None to allow the stop."""
    if ident.status is IdentificationStatus.BOUND:
        ctx = ident.context
        if ctx is not None and ctx.next_action and ctx.next_action.strip():
            return ("Autopilot for project '%s' (key '%s', bound via %s).\n"
                    "Recorded next action: %s"
                    % (ctx.name or ctx.key, ctx.key, ident.binding_path,
                       ctx.next_action.strip()))
        # Bound but the ledger has no recorded next step: continue within the
        # bound project rather than inventing a task.
        return ("Autopilot: this session is bound to project key '%s' (via %s), "
                "but the ledger records no next action. Continue the work you "
                "were already doing in THIS project."
                % (ident.project_key, ident.binding_path))
    if ident.status is IdentificationStatus.FALLBACK:
        return GENERIC_CONTINUATION
    return None  # INVALID or NONE: allow the stop


# --------------------------------------------------------------------------
# Fail-open wiring (integration point for the existing hook)
# --------------------------------------------------------------------------

def main():
    """Minimal stdin/stdout wiring showing how the identification layer is
    consumed. The hook's other rails -- continuation budget, kill-switch file,
    question-detection guard, no-progress fingerprint -- are out of scope here
    and keep their existing implementations; the block below must be ANDed
    with their verdicts before anything is printed."""
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise ValueError("stdin payload is not a JSON object")
        # 'cwd' may be absent; absence means UNBOUND, never os.getcwd().
        ident = identify_session_project(payload.get("cwd"),
                                         payload.get("transcript_path"))
        instruction = continuation_instruction(ident)
        # INTEGRATION POINT: if not rails_permit_blocking(...): instruction = None
        if instruction is not None:
            print(json.dumps({"decision": "block", "reason": instruction}))
        return 0
    except SystemExit:
        raise  # deliberate exits must never be swallowed by the fail-open net
    except Exception:
        # FAIL OPEN: any failure lets the agent stop. No output, exit 0.
        return 0


if __name__ == "__main__":
    sys.exit(main())


# --------------------------------------------------------------------------
# (E) DELETIONS -- tombstones, kept so reviewers can verify intent.
#
# project_from_text() is DELETED, not softened. Scanning the agent's single
# last message for project names is the defect: one passing mention decided
# the fate of whole sessions (projects 33, 23, 21). Do not reintroduce
# single-message text matching in any form.
#
# project_from_cwd() is DELETED, superseded by resolve_project_binding().
# Repositories are not named after ledger keys ('v2ray_pdr',
# 'Ballerina-Motasadea-V1', 'C:\Windows\System32'), and path-component
# prefix matching already leaked via the USERNAME once. Path shape is not
# evidence; the binding file is.
# --------------------------------------------------------------------------
