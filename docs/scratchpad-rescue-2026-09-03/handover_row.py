# -*- coding: utf-8 -*-
import sqlite3, sys
sys.path.insert(0, r"C:\Users\Magic\Desktop\env\mira-ledger")
import ledger

DB = r"C:\Users\Magic\Desktop\env\mira-ledger\ledger.db"
def newest(t):
    c = sqlite3.connect("file:" + DB.replace("\\","/") + "?mode=ro", uri=True, timeout=5)
    try: return c.execute("SELECT MAX(id) FROM " + t).fetchone()[0]
    finally: c.close()

ledger.add_state(
    project="ballerina", date="2026-09-03",
    stage="HANDED OVER (LOCAL TESTED, NOT DEPLOYED) - see verifications#908, #901, #890",
    deploy_location="C:\vualet-web\docs\handover-opencode-2026-09-03.md (commit 60f818d)",
    blockers=(
        "THE ENGINE IN PRODUCTION IS RUNNING THE OLD BUILD. Local gateway hashes "
        "45d6520e56c4797c; deployed hashes 77e9e867368ac59a. Commit 69c6468 - which removes "
        "the third-party advertisement and adds the whole memory layer - is COMMITTED AND NOT "
        "DEPLOYED. Until someone deploys, the customer's family still receives a signup "
        "advertisement on every message they send him. "
        "THE ONE FINDING THAT CHANGES THE PLAN: a citation firewall ALREADY EXISTS in "
        "mira.mjs and already runs - ground() at line 416, groundingBlock() tagging evidence "
        "[tier#id], and enforce() at line 517. The new memory/grounding.mjs verifyResponse is "
        "the same idea with an incompatible ref format ([F1] vs [tenant#12]). DO NOT wire it "
        "as a second parallel firewall. She is not missing a firewall; she is missing anything "
        "to retrieve, because inbound messages were never stored anywhere. The correct "
        "integration is to make message_log a source for the EXISTING ground() adapters. "
        "The kimi wiring patch (session kimi_40dfb21f036d) must NOT be applied as written: "
        "four of its assumptions were checked and are wrong, including a module-scope db that "
        "would ReferenceError on the first message."
    ),
    next_action=(
        "READ C:\vualet-web\docs\handover-opencode-2026-09-03.md FIRST - it is written to be "
        "read cold and carries the traps, the paths and the evidence. Then, in order: "
        "(1) OWNER deploys 69c6468 and applies migration 023 with ALTER TABLE ... OWNER TO mira "
        "in the same step; (2) wire message_log into the existing ground() adapters, NOT a "
        "second firewall; (3) instrument the reply path before optimising it - the prime "
        "suspect for the owner's 20-second latency is the tool-broker pre-pass at mira.mjs:59 "
        "making up to four sequential LLM round trips per message; (4) add the missing fetch "
        "timeouts, 30s main and 15s broker - llm.mjs currently has none at all; (5) configure "
        "the web-search backend from the SearXNG runbook. Do NOT re-open crisis-detection "
        "language coverage or the storefront 404s; both were measured dead on 2026-09-02."
    ),
    evidence=(
        "verifications#890 (crisis detection multilingual 7/7 against the PRODUCTION file), "
        "verifications#891 (45/45 sitemap URLs 200), verifications#901 (autopilot drift fix "
        "18/18 plus confirmed live), verifications#908 (never-lie mechanism 8/8 adversarial), "
        "decisions#488 (raw messages to message_log, not the hash chain), gotchas#672 (the "
        "three defects that stop Mira assisting). Engine suite 628 tests, 0 failures. "
        "Handover committed as 60f818d in C:\vualet-web."
    ),
)
print("state#%d written - handover" % newest("state"))
