# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r"C:\Users\Magic\Desktop\env\mira-ledger")
import ledger

ledger.add_verification(
    project="ballerina", date="2026-08-31",
    claim=(
        "THE LEARNING PIPELINE IS ARMED. observation_consent = granted for the owner's tenant, and "
        "the pulse sweep's gate has flipped from skip:no_consent (777 occurrences over nine days) to "
        "skip:compose_empty - consent now PASSES and the sweep proceeds to composition. The "
        "consent bridge is deployed so every future customer's activation consent lands in the "
        "table the learning machinery actually reads. This CORRECTS one claim in gotchas#603/#604 "
        "territory: the self-chat consent ask was not broken - it had simply never had an ACTIVE "
        "binding to run behind. Within one minute of the binding going active today, Mira asked, "
        "the owner answered, and handleSelfChatConsent wrote granted at 14:28:18 - before the "
        "bridge or backfill even deployed. The bridge remains necessary: a customer who consents "
        "at activation must not depend on happening to answer an in-chat question later."
    ),
    method=(
        "Timeline reconstruction from database timestamps and log grep, then deploy of the "
        "code-author-authored bridge (judge2 gpt-5.1 APPROVE conf 90) with hash preflight, plus "
        "the idempotent backfill migration 021 run once directly (INSERT 0 0 precisely BECAUSE the "
        "in-chat flow had already written the row - the two mechanisms converged on the same state)."
    ),
    result="pass",
    tested_against="engine host 23.88.59.31; observation_consent; /var/log/mira-whatsapp.log",
    evidence=(
        "observation_consent: tnt_6f0611074ddefcff granted, updated_at 2026-08-31 14:28:18.396 - "
        "the same minute as fact seq 63/64 (the owner's first exchange). "
        "Pulse log: last skip reason changed from no_consent to compose_empty after consent. "
        "Gateway deployed at 36020292325223b6 (preflight matched 24bf7380ba022d5c), "
        "observation_consent referenced 3x in the deployed file, node --check clean, service "
        "active. Migration 021_backfill_observation_consent.sql placed locally and on the server. "
        "behavior_facts remains 0, which is EXPECTED: wa-observe distills from outgoing messages "
        "to OTHER people, and the owner has so far only messaged Mira herself. "
        "STILL OPEN toward the sellable learning story: real outgoing traffic to populate "
        "behavior_facts, VIP classification (not designed, not built), and the PUBLIC pairing "
        "route (DNS hijack + dead cloudflared) without which no stranger can ever reach any of it."
    ),
)
print("LEARNING ARMED ROW WRITTEN")
