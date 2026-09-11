# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r"C:\Users\Magic\Desktop\env\mira-ledger")
import ledger

ledger.add_verification(
    project="ballerina", date="2026-08-30",
    claim=(
        "ROOT CAUSE, VERIFIED, for 'I don't remember you, I don't remember your wife': THE WHATSAPP "
        "GATEWAY HAS NO FACT-WRITE PATH AT ALL. Not a broken call, not a swallowed error, not an "
        "encryption problem, and nothing done on 2026-08-29. The code to remember was never wired "
        "into WhatsApp. The owner moved to WhatsApp and Mira's durable memory stopped that morning."
    ),
    method=(
        "Static proof in the source tree, then temporal proof in production. Read-only throughout - "
        "every database statement was a SELECT against information_schema or a GROUP BY count; no "
        "write, migration or schema command was issued."
    ),
    result="fail",
    tested_against="C:\\Ballerina-Motasadea-V1 working tree; engine host 23.88.59.31, postgres db 'mira'",
    evidence=(
        "STATIC: grep -cE 'appendFact|recordFact|indexFact|tenant-ledger|tenantLedger' on "
        "apps/engine/whatsapp-gateway-v2.mjs returns 0. ZERO. Meanwhile telegram-bot.mjs carries the "
        "entire machinery - loadTenantLedger() at line 703, recordFact() at 724 calling "
        "tl.appendFact, and four call sites at 1177, 1178, 1199 and 1200. The two gateways share "
        "respond() in mira.mjs, but recordFact is invoked in the TELEGRAM LAYER, above respond(), so "
        "WhatsApp traffic passes through the shared brain and out again having written nothing. "
        "TEMPORAL: the last fact ever written to tenant_facts is 2026-08-21 09:15:14+00. The single "
        "row in whatsapp_bindings was created 2026-08-21 11:27:20+00 - TWO HOURS AND TWELVE MINUTES "
        "LATER. There has not been one fact since. "
        "SOURCE BREAKDOWN: tenant_facts.source is telegram 19 and system 17. Not one WhatsApp fact "
        "has ever existed. "
        "WHY THE LOGS WERE SILENT: recordFact DOES log its failures - console.error('[tenant-ledger] "
        "append ... failed (non-blocking)'). The journal is quiet because the code never RUNS on the "
        "WhatsApp path, not because it runs and fails quietly."
    ),
)

ledger.add_gotcha(
    project="ballerina", date="2026-08-30", area="memory/what-mira-actually-retains-on-whatsapp",
    symptom=(
        "Mira on WhatsApp has almost no memory, and what she has is a short rolling window. This is "
        "the whole of her recall, measured in production for the owner's tenant "
        "tnt_6f0611074ddefcff: 18 conversation turns and a 261-character encrypted summary."
    ),
    root_cause=(
        "TWO stores, and only the weaker one is wired to WhatsApp. "
        "(1) CONVERSATION MEMORY - tenants.memory_turns_json plus tenants.memory_summary, both "
        "AES-GCM encrypted with the tenant DEK. context() in apps/engine/src/memory.mjs returns "
        "turns.slice(-KEEP) with KEEP = MIRA_MEMORY_TURNS or 20, prefixed by the summary. The model "
        "therefore sees at most the newest 20 turns plus 3-5 summary bullets. Everything older is "
        "gone unless the summary happened to catch it. "
        "(2) THE FACT LEDGER - tenant_facts, hash-chained, head in tenant_ledger_heads. This is the "
        "durable store, the one meant to hold 'my wife's name is X' for a year. On WhatsApp it is "
        "NEVER WRITTEN. "
        "So on WhatsApp Mira runs on the 20-turn window alone. She is not malfunctioning when she "
        "says she does not remember - she is reporting her state accurately."
    ),
    fix=(
        "THE FIX IS SMALL AND ITS SHAPE IS ALREADY PROVEN: recordFact in telegram-bot.mjs:724 is a "
        "self-contained, non-blocking, already-tested helper. WhatsApp needs the equivalent of the "
        "two calls telegram-bot.mjs makes at lines 1199-1200 - one 'observation' for the inbound "
        "text, one 'action'/'system' for the reply - with source 'whatsapp' instead of 'telegram'. "
        "Nothing else changes; the append is O(1) and never reads tenant_facts. "
        "MUST GO THROUGH THE CODE AUTHOR as fragments against pasted anchors, never a whole-file "
        "request - see gotchas#503. Blocked meanwhile by the P0-W3 cross-project write guard. "
        "SECOND, SEPARATE ITEM: the 36 existing facts are intact and readable - the DEK is present "
        "and never rotated. They are Telegram-era facts. Whether the WhatsApp READ path surfaces "
        "them at all is NOT YET ESTABLISHED and must be checked before assuming this is only about "
        "new facts."
    ),
    evidence=(
        "Production, owner's tenant: memory_summary length 261, memory_turns_json 18 entries. The "
        "second tenant tnt_2f17a7e2b2e1acf8 has 0 and 0. KEEP default 20 is set in both "
        "apps/engine/src/memory.mjs and packages/state/src/memory.mjs. tenant_facts holds 36 rows, "
        "tenant_ledger_heads last_seq 36, tenant_deks one row kek_version 1 rotated_at NULL."
    ),
    confidence="verified",
)

ledger.add_gotcha(
    project="ballerina", date="2026-08-30", area="method/two-corrections-to-rows-i-wrote-an-hour-ago",
    symptom=(
        "Two claims I wrote into this ledger earlier today were wrong, and both failed the same way "
        "- I let a table's NAME stand in for knowing what writes to it."
    ),
    root_cause=(
        "CORRECTION 1, to verifications#711. I wrote 'her conversation log is live and writing' on "
        "the strength of 101 rows in a table called `messages`. The `messages` table is NOT the "
        "conversation log. Its ONLY writer is storeUserMessage in apps/engine/src/impersonation.mjs "
        "- it is the style corpus for owner impersonation, sampled to build tenant_style_profiles. "
        "The real conversation log is tenants.memory_turns_json, and it holds 18 turns. "
        "CORRECTION 2, to gotchas#504. I inferred the fact-memory path 'fails the same way' as the "
        "voice path - a swallowed exception. It does not. recordFact logs its failures loudly. The "
        "fact path is not failing; it is ABSENT from WhatsApp. The voice half of #504 stands: "
        "mira.mjs:521 really does swallow a TTS failure with no log, and that is still worth fixing. "
        "A THIRD TRAP, avoided: messages.source reads 'telegram' for all 102 rows, which looks like "
        "channel evidence and is not. mira.mjs:327 calls storeUserMessage(t.id, text, 'telegram') "
        "with the string HARDCODED, on the shared path BOTH gateways use. Every WhatsApp message is "
        "labelled telegram. I nearly built a conclusion on that column."
    ),
    fix=(
        "Before a table name is allowed to carry an argument, find its writer: "
        "grep -rn 'INSERT INTO <table>' --include=*.mjs. One grep would have caught all three of "
        "these. A count from a table whose writer you have not identified is not evidence, it is a "
        "number. "
        "The same rule retired the inference: I had a plausible mechanism - silent swallow - that "
        "fit the symptom, and it was wrong. The static grep that settled it, counting fact-write "
        "calls in the WhatsApp gateway, cost one command and should have come before any theory."
    ),
    evidence=(
        "grep -rn 'INSERT INTO messages' across apps and packages returns exactly one hit: "
        "apps/engine/src/impersonation.mjs:15. grep -rn 'storeUserMessage' returns its definition, "
        "an import at mira.mjs:28, and the single call at mira.mjs:327 with 'telegram' hardcoded. "
        "recordFact's catch block at telegram-bot.mjs:737 is a console.error, not a bare swallow."
    ),
    confidence="verified",
)
print("MEMORY ROOT CAUSE + CORRECTIONS WRITTEN")
