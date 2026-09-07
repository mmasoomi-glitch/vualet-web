# -*- coding: utf-8 -*-
# Assembles the single-file Kimi K3 handover: verbatim code dumps read from disk + specs.
import io, os, hashlib

B = r'C:\Ballerina-Motasadea-V1'
OUT = r'C:\vualet-web\docs\KIMI-K3-HANDOVER-2026-08-31.txt'

def read(p):
    with open(p, 'rb') as f:
        data = f.read()
    return data.decode('utf-8').replace('\r\n', '\n')

def region(text, start_marker, end_marker, include_end=False):
    i = text.index(start_marker)
    j = text.index(end_marker, i)
    if include_end:
        j += len(end_marker)
    return text[i:j]

out = io.StringIO()
w = out.write

w("""================================================================================
KIMI K3 HANDOVER - MIRA (BALLERINA) VIP CLASSIFICATION + PAIRING WIZARD
Date: 2026-08-31. Prepared by the session agent as scribe; every code block below
labeled EXISTS is a byte-faithful dump from the working tree. You (Kimi K3) are
the AUTHOR of the components labeled TO WRITE. Your output will be applied to
disk VERBATIM by the hands and then judged, tested and mutation-tested, so:

OUTPUT CONTRACT (strict):
- For each TO WRITE component, output ONE fenced code block preceded by a line
  `FILE: <exact target path>`. Nothing outside those blocks except the FILE lines.
- JavaScript: ES modules, Node 22, single quotes, 2-space indent, ASCII only,
  no em-dashes. Never invent an API: every function you may call is either in
  the dumps below or in the signatures section. If something is missing, write
  `BLOCKED: <what>` instead of guessing.
- SQL: idempotent (IF NOT EXISTS), parameterised in JS call sites, no DROP.
- Tests: node:test + node:assert/strict only, deterministic (no Math.random,
  no Date.now - callers pass `now`), ids generated as literals.
================================================================================

SECTION 0 - INTENTION (the owner's own words and rulings)

The product: Mira, a WhatsApp companion-assistant. One Baileys session per
customer (customer scans a QR; Mira is a linked device on THEIR account).
The owner's order: "read other messages of the customer with his friends and
contacts and classify them and talk to them in a special way, the VIP
classification."

Owner rulings 2026-08-31 (ledger decisions#461), binding:
1. CONSENT: per-contact hashed counters are covered by the existing observation
   consent - no new checkbox.
2. COUNT: fixed top-5 VIPs; scoring weights are constants in code.
3. NAMING: the VIP fact may store the readable contact name (protected by the
   same per-tenant encryption as all facts).
4. RETENTION: counters purge after 90 days of TENANT inactivity (whole-tenant,
   not per-contact); also purge immediately on consent revocation.
5. MANUAL ALWAYS WINS: a customer's hand-made VIP list is never modified by
   automation.

Also owner-ordered: a rebuilt pairing page as an animated 5-step wizard (spec
in SECTION 6) because the old page's Activate button silently no-ops.

================================================================================
SECTION 1 - WHAT EXISTS: DATABASE MIGRATIONS (EXISTS, deployed or auto-applied)
""")

for rel in ['packages/state/migrations/020_wa_auth_state.sql',
            'packages/state/migrations/021_backfill_observation_consent.sql',
            'packages/state/migrations/022_contact_signals.sql']:
    p = os.path.join(B, rel)
    w(f"\n--- FILE (EXISTS): {rel} ---\n```sql\n{read(p)}```\n")

w("""
Other relevant tables (already in production):
- observation_consent(tenant_id TEXT PK, status IN (asked,granted,declined,revoked), updated_at)
- tenants(id TEXT PK, ..., auto_answer_vips_json TEXT, persona, memory_summary, ...)
- tenant_facts: hash-chained fact ledger; appended ONLY via appendFact (below).

================================================================================
SECTION 2 - WHAT EXISTS: THE ENCRYPTED SESSION STORE (EXISTS, RUNTIME VERIFIED)
Context only - do not modify these.
""")

for rel in ['apps/engine/src/wa-auth-store.mjs', 'apps/engine/src/use-pg-auth-state.mjs']:
    p = os.path.join(B, rel)
    w(f"\n--- FILE (EXISTS): {rel} ---\n```js\n{read(p)}```\n")

w("""
================================================================================
SECTION 3 - WHAT EXISTS: THE SHARD ROUTER (EXISTS, LOCAL TESTED 7/7, mutation-proven)
Context for future scale work - do not modify.
""")
w(f"\n--- FILE (EXISTS): apps/engine/src/shard-router.mjs ---\n```js\n{read(os.path.join(B,'apps/engine/src/shard-router.mjs'))}```\n")

w("""
================================================================================
SECTION 4 - WHAT EXISTS: THE OBSERVATION COUNTER SPLICE (EXISTS, spliced, node --check clean)
This is the live producer of contact_signals rows. Dumped region from
apps/engine/src/wa-observe.mjs (the rest of that file distills behavior facts
and is not to be touched).
""")
obs = read(os.path.join(B, 'apps/engine/src/wa-observe.mjs'))
w("\n--- REGION (EXISTS): wa-observe.mjs, contactRef + bumpContactSignal + observeOutgoing ---\n```js\n")
w(obs[obs.index('// The classifier stores only this hash'):])
w("```\n")

w("""
================================================================================
SECTION 5 - WHAT EXISTS: THE CONSUMERS YOUR OUTPUT FEEDS
""")
aa = read(os.path.join(B, 'apps/engine/src/wa-autoanswer.mjs'))
w("\n--- REGION (EXISTS): wa-autoanswer.mjs classifyPriority - reads the VIP list ---\n```js\n")
w(region(aa, 'export function classifyPriority', '\nexport'))
w("```\n")

gw = read(os.path.join(B, 'apps/engine/whatsapp-gateway-v2.mjs'))
w("\n--- REGION (EXISTS): whatsapp-gateway-v2.mjs pulse sweep timer - the VIP sweep wiring ANCHOR ---\n```js\n")
w(region(gw, '  if (!list.length) return;\n  runPulseSweep({ sessions: list })', "}, 10 * 60 * 1000).unref();", include_end=True))
w("```\n")

tl = read(os.path.join(B, 'packages/state/src/tenant-ledger.mjs'))
w("\n--- SIGNATURE (EXISTS): appendFact from @mira/state - EXACTLY TWO ARGUMENTS ---\n```js\n")
w(region(tl, 'export async function appendFact', '\n  const valueJson'))
w("  // ... validates, encrypts, hash-chains. kind in: observation,preference,commitment,\n  // entitlement,action,correction,retraction,system. source in: telegram,whatsapp,web,\n  // api,system,import,inference. CALL SHAPE: appendFact(tenantId, { kind, statement,\n  // source, scope, value }) - NEVER positional. A judge once demanded positional and was wrong.\n```\n")

w("""
Other in-scope signatures (all importable from '@mira/state'):
- getDb() -> node-postgres pool: .query(text, params) -> { rows }
- encrypt(tenantId, plaintext) -> Promise<ciphertextString>
- decrypt(tenantId, stored) -> Promise<plaintext> (legacy plaintext passes through)
From './vip-classifier.mjs' (YOU are writing it, SECTION 6.1):
- pickVips(rows, now, opts) as specified.

================================================================================
SECTION 6 - TO WRITE: THE REMAINING COMPONENTS (your authoring task)

6.1 FILE: apps/engine/src/vip-classifier.mjs   (pure module, NO imports)
Header comment: deterministic, explainable VIP scoring; no model in the loop;
identical on re-run by design (LAP applies to first parties).
- export const WEIGHTS = Object.freeze({ frequency: 0.4, initiation: 0.3, recency: 0.2, longevity: 0.1 });
  with comment: explainable constants by owner ruling 2026-08-31; change them only with a ledger entry.
- helpers: getNum(val) (finite number or 0), toTimestamp(val) (new Date(val).getTime()),
  round4(n) (Math.round(n*10000)/10000), computeRawComponents(row, nowTs, maxOut):
    MS_PER_DAY = 86400000; msgsOut = Math.max(0, getNum(row.msgs_out));
    frequency = msgsOut / Math.max(1, maxOut);
    initiation = Math.max(0, getNum(row.customer_initiated)) / Math.max(1, msgsOut);
    lastSeenTs/firstSeenTs via toTimestamp of row.last_seen/row.first_seen;
    recency = Number.isNaN(lastSeenTs) ? 0 : Math.exp(-Math.max(0, Math.floor((nowTs-lastSeenTs)/MS_PER_DAY))/14);
    longevity = (either ts NaN) ? 0 : Math.min(1, Math.max(0, Math.floor((lastSeenTs-firstSeenTs)/MS_PER_DAY))/90);
- export function scoreContact(row, now, maxOut): TypeError if row not non-null object;
  nowTs = now instanceof Date ? now.getTime() : now, TypeError unless finite number;
  weighted sum clamped to [0,1]; never NaN.
- export function pickVips(rows, now, opts = {}): TypeError if rows not array;
  defaults k=5, minScore=0.15, minMessages=3; filter getNum(msgs_out) >= minMessages;
  [] if none; maxOut over FILTERED rows; keep score >= minScore; sort score DESC then
  contact_ref ASC via localeCompare; top k as { contact_ref, score: round4(score) }; no mutation.
- export function explainScore(row, now, maxOut): same guards; { frequency, initiation,
  recency, longevity, score } all round4'd, components clamped to [0,1]; MUST reuse
  computeRawComponents - one implementation of the math.

6.2 FILE: apps/engine/src/vip-sweep.mjs
Imports EXACTLY: getDb from '@mira/state'; pickVips from './vip-classifier.mjs'.
Header: the producer half of VIP classification; deterministic, consent-gated,
manual-always-wins; runs beside the pulse sweep.
THE ENVELOPE (comment it clearly): tenants.auto_answer_vips_json is written as
{ "auto": [refs...], "manual": [...] }. Read current value first:
  - parses to ARRAY (legacy manual list) -> preserve it as manual, add auto;
  - parses to OBJECT with manual -> keep manual verbatim, replace only auto;
  - empty/null/unparseable -> { auto: [...], manual: [] };
  - if computed auto identical to stored auto -> SKIP the write.
Downstream (classifyPriority above) parses defensively so both shapes work;
manual entries are NEVER modified by this module.
- export async function sweepVips({ db = getDb(), now = new Date(), k = 5 } = {}):
  one SQL join fetching tenant ids with observation_consent.status='granted' plus
  their current auto_answer_vips_json; per tenant: load contact_signals rows,
  pickVips(rows, now, { k }), envelope rules, UPDATE tenants SET auto_answer_vips_json=$1
  WHERE id=$2 when needed. Per-tenant try/catch (one failure never stops the sweep);
  console.error '[vip-sweep]' prefix, NO contact data ever logged.
  Return { tenants, updated, skipped, errors }.
- export async function purgeStaleSignals({ db = getDb(), days = 90 } = {}):
  DELETE rows only for tenants whose ENTIRE signal set is stale:
  tenant_id IN (SELECT tenant_id FROM contact_signals GROUP BY tenant_id
  HAVING max(last_seen) < now() - ($1 || ' days')::interval). Comment the
  whole-tenant-only distinction (owner ruling: 90 days of tenant inactivity).
  Return deleted count. Parameterise days.
- export async function purgeOnRevocation(tenantId, { db = getDb() } = {}):
  DELETE FROM contact_signals WHERE tenant_id=$1; ALSO rewrite the tenant's
  envelope so auto=[] while manual is preserved (same envelope rules).
  Comment: revocation purges immediately (owner ruling). Return deleted count.

6.3 FILE: apps/engine/test/vip-classifier.test.mjs  (node:test, deterministic)
Tests that catch real regressions:
 1 determinism: same rows+now -> identical pickVips output across two calls.
 2 ordering: construct rows where scores differ; assert exact order; tiebreak by
   contact_ref for two identical rows differing only in ref.
 3 filters: rows below minMessages excluded; below minScore excluded; k cap.
 4 NaN-proofing: rows with garbage last_seen/first_seen/msgs_out yield finite
   scores and never NaN (assert Number.isFinite).
 5 explainScore components sum: frequency*.4+initiation*.3+recency*.2+longevity*.1
   ~= score within 1e-9 before rounding effects (use a row with clean values).
 6 input validation: pickVips throws TypeError on non-array; scoreContact throws
   on null row and on now=undefined.

6.4 FILE: apps/engine/test/vip-sweep.test.mjs  (node:test + mock db)
Fake db: { query(text, params) } recording calls and returning canned rows.
 1 manual-always-wins: stored value is a legacy ARRAY ['keepme']; sweep writes
   envelope with manual ['keepme'] intact and computed auto.
 2 object envelope: stored { auto:['old'], manual:['m1'] } -> manual preserved
   verbatim, auto replaced.
 3 skip-identical: stored auto equals computed auto -> NO update query issued
   (assert by inspecting recorded calls).
 4 per-tenant isolation: two tenants, first's contact_signals query throws ->
   errors=1 and second tenant still processed.
 5 purgeOnRevocation empties auto, preserves manual, deletes signals.
MUTATION REQUIREMENT (the hands will run it): deleting the manual-preservation
branch must fail at least one test.

6.5 FRAGMENT: gateway wiring (NOT a whole file)
Target: apps/engine/whatsapp-gateway-v2.mjs. Using the pulse-timer ANCHOR dumped
in SECTION 5: reproduce the anchor lines and append, INSIDE the same setInterval
callback after the runPulseSweep(...).catch(...) statement, a fire-and-forget
VIP sweep call:
  sweepVips().then(r => { if (r && (r.updated || r.errors))
    console.log('[vip-sweep] tenants=' + r.tenants + ' updated=' + r.updated +
    ' errors=' + r.errors); }).catch(e => console.error('[vip-sweep] failed (fail-open):', e.message));
plus, once per ~24h using a simple counter or modulo on sweep runs (comment the
mechanism), purgeStaleSignals().catch(...) with the same fail-open logging.
Also output the one-line import addition fragment: reproduce the line
  import { runPulseSweep, handlePulseCommand } from './src/wa-proactive.mjs'; // fire-first pulses (requirements#97)
followed by
  import { sweepVips, purgeStaleSignals } from './src/vip-sweep.mjs'; // VIP producer (decisions#458/#461)

6.6 FILE: pairing wizard page fragment (whole PAIRING_PAGE const replacement)
Target: replace `const PAIRING_PAGE = (sessionId) => \\`...\\`;` in
apps/engine/whatsapp-gateway-v2.mjs. Output the complete new const.
CONTRACT (do not invent endpoints):
- Only interpolation: ${sessionId} into `const SID = '...'` in the inline script.
  Escape every OTHER backtick/dollar-brace for the outer template literal, or
  avoid them (string concatenation inside the page JS).
- const KEY = location.hash.slice(1);
- Poll every 2500ms: fetch('/pair/'+SID+'/qr', {headers:{'x-mira-pair-key':KEY}})
  -> { state: 'pairing'|'connected'|'expired' (unknown=pairing), qr: dataURL|null,
       code: 8-char string|null }
- Submit: POST '/pair/'+SID+'/link', headers Content-Type + x-mira-pair-key,
  body JSON { code, consent: { linked_device, observation, stand_in, ban_risk } }.
  Success JSON has success===true; failure has error.
DESIGN (owner-ordered): a vertical rail of 5 steps, each a numbered circle +
label + one-line detail; CURRENT step pulses (CSS keyframes), COMPLETED steps
light up with a check glyph and 300ms transition, future steps dim. Steps:
 1 Scan (WhatsApp > Settings > Linked devices > Link a device)
 2 Connected (Mira joins your account as a linked device)
 3 Say hi to yourself (send any message in WhatsApp's Message-yourself chat)
 4 Enter the code (the 8-char code appears on THIS page; type it below)
 5 Activate (confirm the checkboxes and press Activate)
State mapping: pairing->step1 active + QR shown; connected & no code->step3
active; code present->step4 active + code LARGE monospace with copy affordance;
success->step5 done + full-page success (check, 'Mira is live in your self-chat',
'you can close this page'); expired-> honest expired view, everything dimmed.
CONSENT + CODE IN THE SAME VIEW. Four checkboxes (linked_device, observation
marked 'optional - unlocks learning', stand_in, ban_risk with the WhatsApp-terms
risk wording). Activate button DISABLED with cursor not-allowed until code
length is 8 AND the three required boxes ticked (observation never gates); a
helper line says exactly what is missing. NEVER a silent no-op (the old page's
sin - name it in a comment). Server errors render red, visible. Single
self-contained page, inline CSS/JS, no external resources, mobile-first,
~430px column, cream #FFF8F0, ink #2A1F2D, accent #C2451E, system fonts.
Footer: 'Secured by Mira - your keys are encrypted at rest.'
Title: 'Link Mira to WhatsApp'.

6.7 OPTIONAL (only if capacity remains): wire purgeOnRevocation - output a
fragment for wherever observation consent transitions to revoked/declined in
apps/engine/src/wa-observe.mjs (handleSelfChatConsent). If you cannot see the
exact anchor, emit `BLOCKED: need handleSelfChatConsent source` instead of guessing.

================================================================================
SECTION 7 - HOW YOUR OUTPUT IS APPLIED (so you know the bar)
The hands apply your blocks verbatim to the stated paths, run node --check on
every file, run both test suites plus the existing 9 suites, mutation-test the
manual-wins branch and the resident-stability rule, and only then deploy with
hash-preflighted single-file swaps and one engine restart. Anything that fails
returns to you with the exact error text. Judges (gemini flash + gpt-5.1) review
before application. Write accordingly: complete files, correct spelling, no
placeholders except the sanctioned BLOCKED lines.
================================================================================
END OF HANDOVER
""")

content = out.getvalue()
with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)
print('written:', OUT)
print('size:', os.path.getsize(OUT), 'bytes')
print('sha16:', hashlib.sha256(content.encode()).hexdigest()[:16])
