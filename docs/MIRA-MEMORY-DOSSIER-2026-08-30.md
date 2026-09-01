# MIRA MEMORY DOSSIER — 30 August 2026

Prepared for the judge and the jury, in chunks, at the owner's instruction.
Every claim below carries evidence. Where something is not proven, it is labelled UNKNOWN.

**The short version.** Mira forgot you because the WhatsApp gateway was never wired to write
facts. Not a bug that appeared, not a regression from yesterday's voice work, not encryption
eating your data. The remembering code exists, is tested, and runs on Telegram. It was never
connected to WhatsApp. You moved to WhatsApp on 21 August and her durable memory stopped that
morning. Your 36 existing facts are intact and the key is healthy.

---

## CHUNK 1 — WHERE EVERY LEDGER LIVES

There are **three** distinct hash-chained stores. They are constantly confused with one another,
so this section pins each one down.

### 1.1 The canonical governance ledger — the project's memory, not Mira's

| | |
|---|---|
| Path | `C:\Users\Magic\Desktop\env\mira-ledger\ledger.db` |
| Reader | `python C:\Users\Magic\Desktop\env\mira-ledger\ledger.py context` |
| Holds | decisions, requirements, gotchas, specs, verifications, projects |
| Integrity | every row SHA256-chained to the previous; one altered byte shows `CHAIN BROKEN` |
| Scope | MIRA / Ballerina / AFAQ / Veridian — **agent and project governance** |

This is where my own findings go. It has **nothing to do** with what Mira remembers about you.
When you asked "where is the context ledger, where is her memory" — these are two different
things, and that ambiguity is worth naming once and keeping straight.

### 1.2 Mira's per-tenant FACT ledger — her durable memory

| | |
|---|---|
| Location | PostgreSQL database `mira` on the engine host `23.88.59.31` |
| Tables | `tenant_facts` (the chain), `tenant_ledger_heads` (the head pointer), `tenant_ledger_checkpoints` |
| Code | `packages/state/src/tenant-ledger.mjs` (574 lines) |
| Encryption | every `statement` is AES-GCM ciphertext under the tenant's own DEK |

### 1.3 Mira's conversation memory — the short rolling window

| | |
|---|---|
| Location | same database, columns `tenants.memory_turns_json` and `tenants.memory_summary` |
| Code | `packages/state/src/memory.mjs`, `apps/engine/src/memory.mjs` |
| Window | `MIRA_MEMORY_TURNS` or **20 turns**, plus a 3-5 bullet summary |

---

## CHUNK 2 — THE TENANTS, AND EXACTLY WHAT EACH ONE HOLDS

You asked: *what is my tenant ID? Did you fuck everything up?*

**Your tenant is `tnt_6f0611074ddefcff`. Nothing was destroyed.** Every number below was read
with `SELECT` only — no write, no migration, no schema command was issued at any point today.

### Tenant 1 — `tnt_6f0611074ddefcff` — YOURS

| Item | Value |
|---|---|
| Tier | companion |
| Created | 2026-07-02 |
| Facts in the chain | **36** (`last_seq` = 36) |
| Chain head last moved | **2026-08-21 09:15:14** — nine days ago |
| Conversation turns retained | **18** |
| Summary length | 261 characters (encrypted) |
| Encryption key | present, `kek_version` 1, **never rotated**, created 2026-08-20 16:02:30 |
| WhatsApp binding | created **2026-08-21 11:27:20** |

### Tenant 2 — `tnt_2f17a7e2b2e1acf8`

| Item | Value |
|---|---|
| Tier | enterprise |
| Created | 2026-08-13 |
| Facts | 0 · turns 0 · summary 0 |

Empty, and expected to be — no traffic has ever been bound to it.

---

## CHUNK 3 — HOW THE REMEMBERING FUNCTION ACTUALLY OPERATES

`appendFact(tenantId, fact)` — `packages/state/src/tenant-ledger.mjs:200`.

It is, on inspection, **well built**. This is worth saying plainly, because the defect is not in
this function and no one should go rewriting it:

1. **Validates before it writes.** `kind` against 8 allowed values, `source` against 7,
   non-empty `scope`, non-empty `statement`, `supersedesSeq` an integer >= 1 or null.
2. **Encrypts, then hashes the encrypted bytes.** "The exact bytes that go in the column ARE the
   bytes that get hashed" — so the chain verifies against what is actually stored.
3. **Canonicalises JSON once.** Keys sorted before hashing and storing, so the re-read value
   canonicalises identically and JSONB's normalisation cannot break the chain.
4. **Guards against a forked chain.** A unique `(tenant_id, seq)` constraint means a duplicate
   sequence raises Postgres error 23505 instead of silently forking. It retries once, then
   surfaces the error.
5. **Is O(1).** It never `SELECT`s from `tenant_facts` — proven by a dedicated test that asserts
   the statement log contains no such read whether the chain holds 1 row or 200.
6. **`tenant_id` is inside the hash preimage**, so cross-tenant replay is cryptographically
   detectable.

**And `'whatsapp'` has been an allowed `source` all along** — `FACT_SOURCES`, line 42:
`['telegram', 'whatsapp', 'web', 'api', 'system', 'import', 'inference']`.

The store was built expecting WhatsApp facts. The wiring was simply never done.

---

## CHUNK 4 — THE DEFECT, PROVEN TWO INDEPENDENT WAYS

### Proof 1 — static, in the source

```
grep -cE 'appendFact|recordFact|indexFact|tenant-ledger|tenantLedger' \
     apps/engine/whatsapp-gateway-v2.mjs
0
```

**Zero.** The WhatsApp gateway contains no fact-write call of any kind.

Telegram has the entire machinery:

| Location | What it does |
|---|---|
| `telegram-bot.mjs:703` | `loadTenantLedger()` |
| `telegram-bot.mjs:724` | `recordFact()` -> `tl.appendFact` |
| `telegram-bot.mjs:1177-1178` | records persona-shaping facts |
| `telegram-bot.mjs:1199-1200` | records the inbound observation and the reply |

Both gateways share the same brain — `respond()` in `apps/engine/src/mira.mjs`. But `recordFact`
is called in the **Telegram layer, above `respond()`**. WhatsApp traffic passes through the shared
brain and back out having written nothing.

### Proof 2 — temporal, in production

| Event | Timestamp |
|---|---|
| Last fact ever written | 2026-08-21 **09:15:14** |
| WhatsApp binding created | 2026-08-21 **11:27:20** |
| Facts since | **zero** |

**Two hours and twelve minutes** between the last thing she ever remembered and the moment you
bound WhatsApp. And `tenant_facts.source` reads `telegram 19, system 17` — **not one WhatsApp
fact has ever existed.**

### Why the logs never told us

`recordFact` *does* log its failures — `console.error('[tenant-ledger] append ... failed')`.
A journal grep for `[tenant-ledger]` across all units since 20 August returns **nothing at all**:
no failure line, and no `wired into message path` success line either, with journal retention
reaching back to 18 June. The code is not failing quietly. **It is not running.**

### What this means for what she can recall

On WhatsApp, Mira has been running on the 20-turn window alone — currently 18 turns and a short
summary. When she said she does not remember your wife, **she was reporting her state
accurately.** She was not malfunctioning and she was not inventing.

---

## CHUNK 5 — THE PROPOSED FIX, FOR THE JUDGE TO RULE ON

**Minimum blast radius. One file. No schema change, no migration, no enum change, nothing
touched in `tenant-ledger.mjs`.**

`recordFact` at `telegram-bot.mjs:724` is already self-contained, non-blocking, tested, and
logs its own failures. WhatsApp needs the equivalent of the two calls Telegram makes at
lines 1199-1200 — one `observation` for the inbound text, one `action`/`system` for the reply —
with `source: 'whatsapp'`, which the validator already accepts.

Constraints carried into the authoring request:

- Authored by the **code-author MCP** as fragments against pasted anchors — never a whole-file
  request. See CHUNK 6 for why that distinction is not stylistic.
- Non-blocking: a fact-write failure must never cost the customer their reply.
- It must **log**, so this can never again be invisible for nine days.

### The read path — RESOLVED, and it is good news

This was an open question an hour ago; it is now settled, and it makes the fix smaller.

**The read path is shared and does work on WhatsApp.** `mira.mjs:382` calls `ground(t, text)`
from `lap.mjs`, which at `lap.mjs:28` calls `readFacts(tenantId, { limit: 200 })`; the results are
injected into the system prompt at `mira.mjs:391`. Because this sits inside `respond()`, it runs
for **both** gateways.

So only the *write* half is missing. **No backfill is required** — the moment WhatsApp starts
appending facts, the existing 36 and every new one are already visible to her.

### One caveat that belongs on the record

`mira.mjs:382` reads:

```js
const grounded = await ground(t, text).catch(() => null);
```

If the fact read ever throws — a decryption failure, a database blip — `grounded` becomes `null`,
every fact silently disappears from her prompt, and **nothing is logged**. That is the same
swallow-without-logging pattern as the voice path at `mira.mjs:521`. It is not known to be firing
today, and it is not the cause of what you experienced. But it means a future memory failure would
look exactly like this one and leave just as little trace, so it belongs in the same small
logging fix.

---

## CHUNK 6 — THE SECOND DEFECT: WHY THE CODE AUTHOR KEPT MANGLING BIG WORK

You asked whether there is a fixed token number. **There is.** `C:\code_author_mcp\src\constants.ts`:

```ts
export const MAX_COMPLETION_TOKENS = {
  intent: 1_500,
  author: 8_000,
  judge: 2_000,
} as const;
```

Hard-coded, with **no environment override**. This is not the context window — the dossier going
in can be huge. It is how much the model is allowed to **write back**.

**The arithmetic that explains a whole day of fabrication:** `apps/engine/src/mira.mjs` is 32,138
characters — about **8,034 tokens**. It is *larger than the maximum possible reply*. When a judge
demanded "return the complete file," compliance was physically impossible, so a short plausible
stub came back instead. Four fabrication incidents trace to that, not to carelessness.

Measured sizes this pipeline is routinely asked to handle:

| File | ~tokens |
|---|---|
| `crypto.mjs` | 2,528 |
| `tenant-ledger.mjs` | 6,106 |
| `mira.mjs` | **8,034** |
| `identity.mjs` | **10,013** |

### The blocker, stated plainly

The load-balancing allocator you asked for **has not been authored yet**, and the reason is worth
your attention because it is the same defect eating its own fix.

| Attempt | Prompt size | Task | Result |
|---|---|---|---|
| 1 | ~2,200 tokens | four fragments | **empty completion** |
| 2 | ~2,100 tokens | four fragments | **empty completion** |
| 3 | ~980 tokens | one function + justification | **empty completion** |
| probe | ~480 tokens | trivial clamp function | **approved, $0.007, seconds** |

Size is not the variable — attempt 3 was smaller than the probe in every way that matters and
still returned nothing. The variable is **how much thinking the task requires**. On a reasoning
model, reasoning tokens are drawn from the same 8,000-token completion allowance. A task that
demands real deliberation can spend the entire budget thinking and emit **nothing at all**.

So the cap does not only truncate and fabricate. At the hard end it returns silence. And the work
needed to lift the cap is itself hard enough to trigger it.

**A fourth attempt is running** with the justification burden stripped out, to separate "too much
thinking" from "too much output". Either way the finding stands and is recorded as `gotchas#503`.

**This is a decision for you**, because you named the author model yourself:

- **(a)** Raise the cap by hand first. It is a three-line constant change, but *I* would be
  authoring it, which breaks the rule you set — so I will not do it unless you say so.
- **(b)** Let a different model author this one change, then hand authority back to DeepSeek v4
  Pro once the ceiling is raised.
- **(c)** Keep decomposing into ever-smaller fragments until one gets through.

---

## CHUNK 7 — WHAT I DID TODAY, AND WHAT I DID NOT

**Did — all read-only against production:**

- Inspected the schema and row counts of `mira` on 23.88.59.31 with `SELECT` only.
- Established the two proofs in CHUNK 4.
- Read `memory.mjs` (both), `tenant-ledger.mjs`, `impersonation.mjs`, `magnetic-context.mjs`.
- Gathered the verbatim bytes of `constants.ts`, `pipeline.ts` and `config.ts` for the authoring
  request.
- Wrote six rows to the canonical ledger: `gotchas#503`, `gotchas#504`, `verifications#711`,
  plus the memory root cause and the corrections below.

**Did NOT:**

- Write, migrate, or alter one byte of the production database.
- Author a single line of shipped code myself — every line goes through the code-author MCP.
- Read or expose any secret.
- Apply anything to the Ballerina tree (still blocked by the P0-W3 cross-project write guard).

### Two corrections to my own earlier claims

Both were the same mistake — letting a table's *name* stand in for knowing what writes to it.

1. **I said "her conversation log is live and writing"** on the strength of 101 rows in a table
   called `messages`. Wrong. `messages` has exactly one writer — `storeUserMessage` in
   `impersonation.mjs` — and it is the **style corpus for owner impersonation**, not the chat log.
   The real conversation log holds 18 turns.

2. **I inferred the memory path was failing silently**, like the voice path. Wrong. It is not
   failing; it is **absent**. A plausible mechanism fitted the symptom and was still false. The
   one grep that settled it should have come before the theory, not after.

*A trap I nearly fell into:* `messages.source` reads `'telegram'` for all 102 rows, which looks
like channel evidence. It is not — `mira.mjs:327` hardcodes the string on the shared path **both**
gateways use. Every WhatsApp message is labelled telegram.

---

## CHUNK 8 — OWNER-ONLY ITEMS STILL OUTSTANDING

1. **Rotate `SEARCH_API_KEY`** — exposed by `systemctl cat` rendering an inline `Environment=`
   line. Recorded as `gotchas#499`.
2. **Voice ID has two sources of truth** — a systemd drop-in sets your clone and wins; the runtime
   dotfile still names the placeholder. Recorded with the exact cleanup steps.
3. **The author-model decision** in CHUNK 6.
4. **The 36 orphaned facts** — pending the judge's ruling on the read path (CHUNK 5).
