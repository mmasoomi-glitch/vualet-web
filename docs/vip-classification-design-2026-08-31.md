# VIP CLASSIFICATION — DESIGN DOSSIER FOR THE JUDGE AND JURY
### 31 August 2026 · owner-ordered ("the whole design has to go in front of the judge and the jury to be implemented")

Every integration point below was verified in the source tree today. Nothing here is invented;
where a choice is open, it is listed as a question for the jury or the owner, not silently decided.

---

## CHUNK 1 — WHAT THE OWNER ASKED FOR, IN HIS WORDS

> "It was supposed to read other messages of the customer with his friends and contacts and
> classify them and talk to them in a special way, the VIP classification."

Decomposed: **(a)** observe the customer's own outgoing WhatsApp traffic, **(b)** classify the
customer's contacts by importance, **(c)** treat classified contacts specially when Mira acts on
the customer's behalf.

## CHUNK 2 — WHAT ALREADY EXISTS (verified today, with the pipeline now ARMED)

| piece | where | state |
|---|---|---|
| Consent gate | `observation_consent` table; granted for the owner 14:28Z; `/link` bridge deployed for future customers | **LIVE** |
| Observation of outgoing messages | `wa-observe.mjs` → `observeOutgoing`, consent-gated | **LIVE, armed** |
| Fact distillation | `wa-observe.mjs:304-309` → `addBehaviorFact(tenantId, 'knowledge'|'style', …)` | **LIVE** (0 rows yet — awaits real traffic) |
| **A VIP consumer, already wired** | `wa-autoanswer.mjs:304` `classifyPriority({ …, vips })` reads `tenant.auto_answer_vips_json` at `:502` | **LIVE** — but the list is only ever set **manually** |
| Grounded reply tone | `ground()`/`groundingBlock` inject tenant facts into every reply | **LIVE** |

**The design consequence:** VIP classification is not a new subsystem. It is the missing
**producer** for a consumer that already ships: something must *write* `auto_answer_vips_json`
and the grounding facts, from observed traffic, instead of a human editing JSON.

## CHUNK 3 — PROPOSED DESIGN (deterministic first; no model in the loop)

**3.1 Signal collection.** Extend `observeOutgoing`'s existing distillation with a per-contact
counter table `contact_signals` (tenant_id, contact_ref, msgs_out, msgs_in, days_active,
customer_initiated, last_seen). `contact_ref` is the **hashed** external id (the codebase already
hashes JIDs via `waRef`/`ctSha256` for logs) — the raw number is not stored by the classifier.
No message content is stored by this table; counts and timestamps only.

**3.2 Scoring, deterministic and explainable.** A nightly (or per-N-messages) sweep computes per
contact: frequency rank, recency decay, initiation ratio, and longevity. Score = weighted sum;
the weights are constants in one file. Top-K (default 5) with a minimum floor become VIPs.
No LLM call: the classification must be **cheap, explainable to the customer, and identical on
re-run** — the LAP rules apply to first parties too. (A later, separate proposal may add
model-assisted relationship labels; it is out of scope here.)

**3.3 Output, two writes per change.**
1. Update `tenants.auto_answer_vips_json` — the existing consumer picks it up with zero new code.
2. Append a `tenant_facts` entry (kind `preference`, source `inference`) — "«ref» is a frequent
   contact of yours" — so grounded replies can reflect it and the hash chain records when and why
   someone became a VIP. `'inference'` is already an allowed source in `FACT_SOURCES`.

**3.4 Special treatment (phase 1 = zero new surface).** Away-mode already prioritises VIPs via
`classifyPriority`. Grounding already shapes tone from facts. Phase 1 ships **only the producer**;
observable behaviour change is: away-mode auto-answer starts prioritising the right people
without the customer configuring anything. Richer per-VIP behaviours are a phase 2 decision.

**3.5 Consent and revocation, hard rules.** The sweep runs only where `observation_consent =
'granted'` (same gate as pulses). On `revoked`/`declined`: the sweep deletes that tenant's
`contact_signals` rows and stops updating the VIP list; a retraction fact records the purge.
The customer can always overwrite the list manually — manual edits win (a `source` marker on the
JSON distinguishes auto from manual; auto never clobbers manual).

## CHUNK 4 — QUESTIONS THE JURY MUST RULE ON
1. Is storing per-contact **counters against hashed refs** within the consent the customer gave
   ("read my own outgoing messages to learn"), or does it need its own consent line on the page?
2. Top-K=5 and the scoring weights — accept the defaults as constants, or owner-tunable per tier?
3. Should a human-readable VIP fact name the contact (readable in her replies) or keep only the
   hashed ref (stronger privacy, weaker product)? This is the single biggest product-vs-privacy
   call in the design.
4. Retention of `contact_signals` for a paying-but-inactive tenant: cap at N days?

## CHUNK 5 — BUILD PLAN (all code via code-author MCP, fragments only)
1. Migration: `contact_signals` table (+ index) — one small SQL artifact.
2. `wa-observe.mjs` splice: bump counters where facts are already distilled (existing consent
   gate wraps it for free).
3. New module `vip-classifier.mjs`: pure scoring function (unit-testable, mutation-testable, same
   discipline as `shard-router.mjs`) + the sweep that writes the two outputs.
4. Wire the sweep beside `runPulseSweep` (same cadence machinery).
5. Tests: pure-function suite + a mutation check that deleting the manual-wins guard fails a test.

**Blocked on:** jury verdict on Chunk 4 · code-author upstream recovering (DeepSeek returning
empty completions since ~14:35Z) · real outgoing traffic to populate signals.
