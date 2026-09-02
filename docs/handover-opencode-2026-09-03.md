# HANDOVER — Mira / Ballerina, for whoever takes this next

Written 2026-09-03. Assume you know nothing about this project. Everything you
need is here or is reachable from a path in here. Every claim below is either
marked VERIFIED (I ran something and saw the output) or labelled otherwise.
Where I am unsure I say so rather than guess — the owner has been burned by
confident wrong answers and will check.

---

## 0. READ THIS FIRST — the five things that will waste your day

1. **The canonical ledger is the source of truth, not this document and not the
   code comments.** It is at `C:\Users\Magic\Desktop\env\mira-ledger\ledger.db`,
   SHA256 hash-chained across six tables. Query it before you claim anything:
   ```
   python "C:\Users\Magic\Desktop\env\mira-ledger\ledger.py" context
   ```
   **But ledger rows go stale.** On 2026-09-02 I found two of the five ranked
   "sales blockers" had already been fixed weeks earlier and nobody updated the
   row. Verify a blocker still exists by running something before you work on it.

2. **You are not the code author.** The owner's standing rule: code is authored
   by the `code-author` MCP or the `kimi` MCP, and you are the hands that apply
   and verify it. This is not a formality — see §7 for the three times a model's
   own confident assumptions would have broken production, and were caught only
   because someone checked them against the real files.

3. **Never open `whatsapp-gateway-v2.mjs` in text mode.** A Python text-mode
   round trip on it silently converted 2,145 line endings. Read and write it as
   `'rb'`/`'wb'` and assert every anchor is unique before replacing.

4. **`journalctl` is blind on this host.** The services use
   `StandardOutput=append` and log to `/var/log/mira-*.log`. Every journal search
   you run will return nothing and you will conclude the service is silent. It
   isn't.

5. **Never run `systemctl cat` on a Mira unit.** It renders inline
   `Environment=` lines and that is how `SEARCH_API_KEY` leaked (`gotchas#499`).
   `systemctl show mira-whatsapp -p NRestarts` is safe.

---

## 1. WHAT THE PRODUCT IS

Mira is a paid, multi-tenant AI assistant sold WhatsApp-first. A customer signs
up on the web, then links their **own personal WhatsApp account** to the engine
by scanning a pairing QR. This uses **Baileys** — the unofficial library, a real
WhatsApp account, not the Business API. That carries ban risk and the customer
consents to it explicitly at pairing.

The engine holds **one long-lived socket per customer inside one Node process**
(`const sessions = new Map()`). Customers are residents, not requests. This is
the single most important architectural fact in the system: **you cannot put a
load balancer in front of it.** Sessions must be *sharded*, not balanced. A
design for that exists at `apps/engine/src/shard-router.mjs` (consistent hashing,
128 virtual nodes, resident-stability rule) but is **not wired to anything**.

### Where the code lives

| what | absolute path |
|---|---|
| Engine monorepo | `C:\Ballerina-Motasadea-V1` |
| WhatsApp gateway | `C:\Ballerina-Motasadea-V1\apps\engine\whatsapp-gateway-v2.mjs` |
| Reply generator | `C:\Ballerina-Motasadea-V1\apps\engine\src\mira.mjs` |
| Safety / crisis | `C:\Ballerina-Motasadea-V1\apps\engine\src\safety.mjs` |
| LAP grounding | `C:\Ballerina-Motasadea-V1\apps\engine\src\lap.mjs`, `lap-tier-router.mjs` |
| Shared state pkg | `C:\Ballerina-Motasadea-V1\packages\state\src\` |
| Migrations | `C:\Ballerina-Motasadea-V1\packages\state\migrations\` |
| Marketing site | `C:\vualet-web` (Next.js, `src/app`) |
| Canonical ledger | `C:\Users\Magic\Desktop\env\mira-ledger\ledger.db` |

Production engine host: **`23.88.59.31`**, app root `/opt/mira`, service
`mira-whatsapp`, DB user `mira`. Public API: `https://api.mira.vualet.com`.

---

## 2. EXACT STATE AS OF THIS HANDOVER — VERIFIED

```
branch          remediation/wa-connect-pairing
HEAD            69c6468  feat(memory): she reads the conversation now...
                4d2d103  feat(engine): encrypted session store, WhatsApp memory, VIP...

local gateway   sha256 45d6520e56c4797c
DEPLOYED        sha256 77e9e867368ac59a          <-- DIFFERENT. Not deployed.
service         mira-whatsapp: active
tests           628 tests, 0 failures
```

**The engine in production is running the OLD build.** Commit `69c6468` — which
removes the advertisement and adds the memory layer — is **committed locally and
not deployed**. Nothing you read below about the advert being "removed" is true
on the live system until someone deploys.

### Uncommitted work that is NOT yours

```
 M apps/engine/src/builtins.mjs
 M apps/engine/src/ocr.mjs
 M apps/engine/src/wa-link-policy.mjs
 M apps/engine/telegram-bot.mjs
 M apps/engine/test/wa-link-policy.test.mjs
```

Another agent is working in this tree. **Stage by explicit path, never
`git add -A` or `git add .`** — you will commit their half-finished work.

---

## 3. THE THREE DEFECTS THE OWNER ACTUALLY CARES ABOUT

He described them in his own words. All three are verified in source.

### 3.1 "On each message from family it introduces itself" — FIXED, NOT DEPLOYED

The identity gate in `whatsapp-gateway-v2.mjs` treated every non-tenant as a
sales prospect:

```js
if (gate.reason === 'onboarding_required') {
  await s.sock.sendMessage(jid, {
    text: "Hi! I'm Mira — a private AI assistant. To get started, sign up at
           mira.vualet.com and link your WhatsApp. 💛" });
}
```

His mother, his doctor, his employer are not tenants. Every message they sent
him got a signup pitch — and **there was no rate limit on this branch**, so five
messages produced five identical pitches into his personal relationships.

**Status:** removed in `69c6468`. Third parties now get silence. Backup at
`whatsapp-gateway-v2.mjs.bak-advert`. The away-mode module *above* this gate
still answers when the customer explicitly enables it, already rate-limited per
contact by `tenants.auto_answer_window_minutes` (default 60).

### 3.2 "If he hasn't read my messages what help can he provide" — PARTLY BUILT

`wa-observe.mjs` gates on:

```js
export function shouldObserve(msg, selfJid) {
  if (!msg?.key?.fromMe) return false;   // ONLY what the customer WROTE
```

**She has never read a single message anyone sent him.** No inbound is stored.
No history backfill exists, so nothing before consent exists at all. Observation
produces at most 8 distilled facts per sweep.

**Status:** the store is built and committed, **not wired**. See §4 for the
architecture, and §4.3 for the correction that matters most.

### 3.3 "It takes 20 seconds on each simple question" — DIAGNOSED, NOT FIXED

Not measured by me; the owner reports ~20s. **UNKNOWN** which stage dominates.
The ranked hypotheses, from the jury (kimi-k3, 2026-09-02):

1. **The tool-broker pre-pass.** `mira.mjs:59` makes its *own* LLM call
   (`maxTokens: 220`, `maxRounds: 3`) **before** the main call. That is up to
   **four sequential LLM round trips for one simple question.** This is the
   prime suspect and no GPU purchase fixes it.
2. Main call latency via OpenRouter → `deepseek/deepseek-chat`.
3. Queue wait: `sock.ev.on('messages.upsert', ...)` does
   `for (const m of messages) { await handleMsg(...) }` — **strictly
   sequential**, so a customer's 5th message waits on four full round trips.
4. Postgres on gate / entitlement / persona reads.
5. Post-LLM work before the send.

**`llm.mjs` has NO timeout and no `AbortSignal` on the fetch at all.** One hung
OpenRouter connection pins that customer's queue forever. The jury ruled this a
defect in its own right regardless of the latency cause: 30s for the main call,
15s for the tool broker, via `AbortSignal.timeout` (native in Node 20).

**Instrument before optimising.** The exact spans the jury specified:
`msg.received → crisis.scan → db.gate → db.entitlement → db.persona_facts →
llm.tool_broker (with round count) → llm.main → post.leak_filter →
post.fact_writes → post.metering → msg.send`, one `trace_id` per message, emitted
as a single structured log line.

---

## 4. THE MEMORY LAYER — what shipped, and the correction that changes the plan

### 4.1 What is committed in `69c6468`

| file | purpose |
|---|---|
| `packages/state/migrations/023_message_log.sql` | `message_log`, `message_retention`, `learning_cursors` |
| `apps/engine/src/memory/message-log.mjs` | append/read/delete/retention |
| `apps/engine/src/memory/retrieval.mjs` | seeds + breadcrumbs, IDF + recency, no embeddings |
| `apps/engine/src/memory/grounding.mjs` | provenance injection, NO_DATA gate, `verifyResponse` |
| `apps/engine/src/memory/learning.mjs` | batched distillation into the fact ledger |
| `apps/engine/test/abstention.test.mjs` | 8 adversarial never-lie tests, all passing |

**Why raw messages are NOT in `tenant_facts`** (`decisions#488`): the fact ledger
is hash-chained, so nothing in it can be deleted without breaking
`verifyChain()`. Raw conversational text is exactly the data that attracts
deletion demands. The jury's phrase: *"a self-inflicted legal wound."* So
`message_log` is deletable per contact, per tenant, and by 180-day retention;
only distilled facts reach the chain. **The owner asked for "every message
committed to the tenant's ledger" — the purpose is met, the form was declined,
and he was told.**

### 4.2 The never-lie mechanism — VERIFIED, 8/8

The owner: *"never lying about missing data or non-existent data is a MUST."*
Kimi's ruling: a system-prompt sentence *"is not a mechanism — it is a suggestion
the model ignores under pressure."* Three layers, and the third is the one that
bites: `verifyResponse()` runs on every answer and rewrites ungrounded or
falsely-cited output into an honest abstention **before it can be sent**.

Proven cases: a fabricated blood-test result, a wedding date never mentioned, a
lie about the assistant's own past, and a citation to a fact that does not exist
are all blocked. A cited real fact passes. *"What is the capital of Peru?"* is
**not** forced to abstain — a naive always-abstain rule would make the product
useless.

### 4.3 ⚠ THE CORRECTION THAT MATTERS MOST — READ BEFORE YOU WIRE ANYTHING

**A citation firewall already exists in `mira.mjs` and it already runs.**

```
mira.mjs:416  const grounded = await ground(t, text)      // tiered retrieval
mira.mjs:425  sys += `Facts from this customer's record...${groundingBlock(grounded)}`
mira.mjs:517  reply = await enforce(reply, grounded, text);   // LAP firewall
```

`groundingBlock()` in `lap-tier-router.mjs` tags evidence `[tier#id]`. `enforce()`
blocks uncited claims. **This is the same idea as the new `grounding.mjs`, with an
incompatible ref format (`[tenant#12]` vs `[F1]`).**

So: **do not wire `verifyResponse` as a second parallel firewall.** She is not
missing a firewall. She is missing anything to retrieve — `ground()` reads the
fact ledger, and inbound messages were never written anywhere. The correct
integration is to make **`message_log` a new source for the existing `ground()`
adapters** and let the firewall that is already there do its job.

This discovery is why I stopped rather than applying the wiring patch. Applying
it would have produced two firewalls with clashing citation formats.

### 4.4 The wiring patch that exists but must NOT be applied as written

Kimi authored a wiring patch (session `kimi_40dfb21f036d`). **Four of its
assumptions are wrong** — I verified each against the real files:

| it assumed | reality |
|---|---|
| `sys = LAP_PREAMBLE + persona + LANGUAGE_LOCK` | built incrementally over ~15 lines (359→451); **more is appended after the language lock** |
| module-scope `db` in the gateway | line 292: *"db is function-local everywhere in this file — `getDb()` here, or ReferenceError"* |
| `resilientChat` from `./src/llm.mjs` | it is `./src/resilient.mjs` |
| module-scope `logger` | does not exist; the file uses `console` |

Its **rulings** are sound and worth keeping: grounding injected on every message
(not only when retrieval is non-empty, or the abstention gate is disabled exactly
when it matters); `kind` and `cost` preserved on a rewrite; inbound persisted
before `respond()`; learning loop fire-and-forget with its rejection caught;
every new call individually try/caught so no memory failure can cost a customer
their reply.

---

## 5. WHAT IS ACTUALLY LEFT — in the order I would do it

1. **Deploy `69c6468`.** Owner-only. The advert keeps firing at his family until
   this happens. Preflight the gateway hash before swapping (see §8).
2. **Apply migration 023** on the engine host, and **`ALTER TABLE ... OWNER TO
   mira`** in the same step. Omitting that is what caused `permission denied for
   table wa_auth_state` after migration 020.
3. **Wire `message_log` into `ground()`** — §4.3. This is the change that makes
   her an assistant instead of a stranger.
4. **Instrument the reply path** — §3.3. Do not optimise before measuring.
5. **Add the fetch timeouts** — 30s / 15s. Independent of the latency cause.
6. **Kill the tool-broker round trips** if the traces confirm hypothesis 1.
7. **Web search backend.** Code is complete and 35/35 green; it is pure
   configuration. Runbook at
   `C:\Users\Magic\AppData\Local\Temp\claude\C--vualet-web\319cd612-0825-4093-a119-11f2d36340fa\scratchpad\RUNBOOK-web-search-searxng.md`
   — **copy it somewhere durable, it is in a temp directory.** The trap it
   documents: SearXNG ships with JSON output **disabled** and returns HTTP 403
   on `?format=json` until `search.formats` includes `json`, while the web UI
   looks perfectly healthy the whole time.

### Owner-only, unchanged
Rotate `SEARCH_API_KEY` (`gotchas#499`) · set `MIRA_BILLING_PUSH_SECRET` to the
same value on engine and web or revocation lags · one real card payment plus a
refund · exercise the four capabilities from a real phone · delete the dead
"Mira" entry from phone Linked Devices.

### Open security incident
Something wrote `127.0.0.1 openrouter.ai # veridian-egress` into the hosts file.
The owner states he did not. It has been removed; **the writer is unidentified.**
Diagnostic signature if it returns: `nslookup` succeeds (it bypasses hosts),
`curl` by name fails, `curl --resolve` to the IP succeeds.

### Decisions waiting on the owner, not on you
- `whatsapp_consent.scope` defines `stand_in` as *"Mira sends messages as the
  customer"*. The jury **refused to build** impersonation — *"the customer
  consented; the person on the other end did not"* — and ratified an openly
  attributed assistant reply instead. If that ships, the signed disclosure text
  over-promises and needs rewording. **He has said legal comes later. Do not
  raise it again unprompted; he found it obstructive and he is entitled to
  sequence his own project.**

---

## 6. GOVERNANCE — the rules you inherit

Global rules live in `C:\Users\Magic\.claude\CLAUDE.md`. The ones that bite:

- **Ledger first.** Query it before disk, git, SSH or runtime. Log every task;
  an unlogged task did not happen.
- **Completion labels, only these:** `SCOPED / SCAFFOLDED / IMPLEMENTED—UNTESTED
  / LOCAL TESTED / RUNTIME VERIFIED / INDEPENDENTLY REVIEWED / INTEGRATED /
  DEPLOYED / BLOCKED / REJECTED`.
- **Forbidden:** `git add -A`, `git add .`, `git reset --hard`, `git clean -fd`,
  `git stash pop`, `--no-verify`, force push.
- **Never weaken a test, never fake a pass.** If you must retarget a tripwire
  because names changed, preserve every assertion and say so — I did this once
  (§7.4) and the file went from 9 assertions to 14.
- **Never bypass a governance guard to make an error go away.**
  `LEDGER_GUARD_DISABLE=1` may only be set by the owner, in-turn, explicitly.
- **Every file you mention to the owner: full absolute path.**
- **Owner-only:** production deploy, real payment, DNS/firewall, destructive data
  ops, real customer communication, paid purchase, missing credential.
- The owner asked that remote/SSH commands be shown to him before running. He
  raised this himself after watching `ssh root@…` scroll past.

### The active guards
- `~/.claude/hooks/ledger-guard.py` — PreToolUse. Blocks edits without a claim,
  blocks `.env` reads, blocks destructive git. **P0-W2** protects `~/.claude`;
  **P0-W3** blocks cross-project writes. Both fired on me and both were right.
  To write a file you must claim it first:
  ```
  python "C:\Users\Magic\.claude\skills\context-ledger\context_ledger.py" claim --target "<repo-relative path>" --task "<what you are doing>" --ttl 3600
  ```
- `~/.claude/hooks/ledger-stop-guard.py` — Stop. Blocks **once** if a session
  ends having written zero ledger rows. Fails open. Nothing to do with projects.
- `~/.claude/hooks/autopilot-jury-stop.py` — Stop. See §9.

---

## 7. THE FIVE MISTAKES THAT COST THE MOST TIME — do not repeat them

**7.1 A model's confident assumption is not a fact.** Kimi proposed a new
`crypto.mjs` and a `tenant_keys` table. `packages/state/src/crypto.mjs` already
implements the identical envelope — `{"__enc":1,"v":1,"kv":…,"iv":…,"tag":…,"ct":…}`,
`ct` field and all — with per-tenant DEKs from migration 005. A second key store
forks key custody. It also proposed a `thirdparty_rate_limit` table when
`tenants.auto_answer_window_minutes` already existed and `wa-autoanswer.mjs`
already implemented the gate. **Always grep for the thing before you build it.**

**7.2 Judge1 in the `code-author` pipeline induced defects three times.** It
demanded a positional `appendFact(tenantId, kind, statement)`. The real signature
is `appendFact(tenantId, fact = {})` — two arguments, the second an object — and
every call would have thrown *"a fact needs a non-empty statement"*. GPT-5.1
overruled it each time. Paste the verbatim signature into the dossier and
instruct the pipeline not to accept a review note asking for a different one.

**7.3 `code-author`'s kimi-k3 stage returns empty completions** (`gotchas#660`).
Not an outage: the model is listed and live. **INFERRED, strongly supported** —
the reasoning budget consumes the whole `max_tokens` allowance before any content
is emitted. The identical dossier through the `kimi` MCP with
`max_tokens: 32000` returned 19,770 output tokens of complete work. Use
`mcp__kimi__kimi_author` with a generous `max_tokens` for anything substantial.
**Also: MCP results arrive HTML-escaped** — `&gt;`, `&lt;`, `&amp;&amp;`. Applied
verbatim the code will not parse. Unescape before writing.

**7.4 Measure the guess against real data before shipping it.** Three separate
governance rules that read as obviously correct were each proven harmful by
running them: a ledger veto that would have permanently disabled autopilot on 5
of 26 projects; a project fallback that returned "Dr. Toobaei Clinic OS" live
during Mira work; and a message that claimed the ledger was "unreadable" when it
had been read perfectly and simply matched nothing.

**7.5 My own worst error in this session:** I told the owner the autopilot hook
"never reads the working directory". It does — line 509. I had not read the
file I was describing. Read before you describe.

---

## 8. HOW TO DEPLOY SAFELY (owner-attended)

The pattern that has worked, and why each step exists:

```bash
# 1. PREFLIGHT — refuse to proceed unless the live file is what you inspected.
ssh root@23.88.59.31 "sha256sum /opt/mira/apps/engine/whatsapp-gateway-v2.mjs"
#    Expect 77e9e867368ac59a. Anything else means someone else deployed.

# 2. Syntax-check every incoming file BEFORE anything moves.
node --check apps/engine/whatsapp-gateway-v2.mjs

# 3. Back up on the host, copy, then restart.
# 4. Verify by IMPORT inside the running engine, not by grep:
#    node -e "import('./src/memory/message-log.mjs').then(m => console.log(Object.keys(m)))"
# 5. systemctl show mira-whatsapp -p NRestarts    (NEVER systemctl cat)
```

Migrations run as `postgres`; the app connects as `mira`. **Always
`ALTER TABLE ... OWNER TO mira` in the same step.**

---

## 9. THE AUTOPILOT HOOK — how sessions stay on their own project

Background: the Stop hook used to infer a session's project by scanning **the
agent's own last message** for project names. One passing mention hijacked whole
sessions — a Go/Python VPN repo was handed *"Continue Stage 1: src/graph.ts +
mocked-fetch tests"* and started building the wrong product, three times in one
day (`gotchas#658`).

**Fixed and live.** `C:\Users\Magic\.claude\hooks\project_identity.py`
(sha `47e005e1ffee5639`) resolves a session's project from an explicit
per-repository binding file:

```
<repo root>\.autopilot-project      # one line, the exact ledger project key
```

The walk stops at the `.git` root so a parent binding cannot capture sibling
checkouts. If unbound, it falls back to a prevalence count over the **whole
transcript** requiring ≥5 mentions, ≥3 lead and ≥2:1 — otherwise silence.
**Unbound is the safe mode:** only a binding can produce a quoted task, so an
unbound repo structurally cannot receive another project's work.

**To bind a repo:** verify the key exists first —
```
python -c "import sqlite3;c=sqlite3.connect('file:C:/Users/Magic/Desktop/env/mira-ledger/ledger.db?mode=ro',uri=True);[print(r) for r in c.execute('SELECT id,key,name FROM projects ORDER BY key')]"
```
The engine repo is bound to `ballerina`. `C:\vualet-web` is **deliberately
unbound** — it resolved BOUND to `vualet` and then quoted a `src/graph.ts` task
into a Next.js tree. A binding guarantees the right *project*; only a fresh
ledger row guarantees a right *instruction*.

Note there are **two** MiraVPN project rows (`gotchas#659`): `mira-vpn` (id 1, no
state row) and `miravpn` (id 33, all the real history). Bind to **`miravpn`**.

Kill switch: create `C:\Users\Magic\.claude\autopilot\DISABLED`.
Rollback: `C:\Users\Magic\.claude\settings.json.bak-rewire-20260902T033935Z`.

---

## 10. WHAT IS PROVEN, WITH THE EVIDENCE

| claim | evidence |
|---|---|
| Crisis detection is multilingual **on the live engine** | The repo's own suite, run against the file pulled from production: **7/7**, English + native-script Arabic/Urdu/Persian/Devanagari + romanised. Hash differs from local by line endings only (77 CRLF). `verifications#890` |
| The storefront 404 blocker is false | **45/45** sitemap URLs return 200, including `/pricing` and all three legal pages. `verifications#891` |
| Never-lie is mechanical | **8/8** adversarial tests. `verifications#908` |
| The drift fix works | **18/18**, including the hijack test: text stuffed five times with other project names, bound cwd → still resolves correctly. `verifications#901` |
| Autopilot works live | It fired on a real stop in an unbound repo and quoted no task. `verifications#901` |
| Engine suite | **628 tests, 0 failures** |

**Crisis detection deserves one specific warning.** The reply text and hotline
numbers are English **on purpose**, and the source says why: *"a wrong emergency
number could get someone killed."* Detection widening was done; reply
translation is owner work. **Never invent or alter a hotline number.**

---

## 11. SCRATCHPAD CONTENTS — copy anything you want to keep

Everything in
`C:\Users\Magic\AppData\Local\Temp\claude\C--vualet-web\319cd612-0825-4093-a119-11f2d36340fa\scratchpad\`
is in a **temp directory and will be lost**. Worth rescuing:

- `RUNBOOK-web-search-searxng.md` — the six-step SearXNG runbook with rollback
- `engine-drop\` — the mirrored tree of the memory layer (already committed)
- `project_identity.PROPOSED.py`, `install_hook.py`, `test_patched_hook.py`
- `kill_advert.py`, `fix_tripwires.py`, `apply_patch.py` — the binary-safe
  patchers, all with unique-anchor assertions; good templates
- `write_*.py` — the ledger-writing scripts, showing the correct API signatures

Earlier dossiers are already committed in `C:\vualet-web\docs\`:
`MIRA-MEMORY-DOSSIER-2026-08-30.md`, `MIRA-SCALE-DOSSIER-2026-08-31.md`,
`KIMI-K3-HANDOVER-2026-08-31.txt`, `vip-classification-design-2026-08-31.md`.

---

## 12. WORKING WITH THIS OWNER

He is technical, he checks, and he has been awake two nights. Specifics:

- **He hates being asked about the obvious.** His words: *"About the things that
  are crystal clear, you don't need to consult me. We do the best practice in
  each turn regardless of what I say."* Make the call and tell him what you did.
- **He hates hedged progress reports** ending in "next I will…". Finish, then
  report.
- **He wants legal and disclosure questions deferred.** He said so explicitly and
  he is right that they were slowing the build. Note them in the ledger, do not
  put them in front of him again unprompted.
- **He wants proof, not assertion.** Run the thing. Quote the output.
- Correct yourself plainly when wrong, once, and move on. No grovelling.

---

*Chain state at handover: all six ledger tables verified OK. Latest rows —
`decisions#488`, `verifications#908`, `gotchas#672`.*
