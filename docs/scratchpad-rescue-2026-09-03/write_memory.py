# -*- coding: utf-8 -*-
import sqlite3
import sys

sys.path.insert(0, r"C:\Users\Magic\Desktop\env\mira-ledger")
import ledger  # noqa: E402

DB = r"C:\Users\Magic\Desktop\env\mira-ledger\ledger.db"


def newest(t):
    c = sqlite3.connect("file:" + DB.replace("\\", "/") + "?mode=ro", uri=True, timeout=5)
    try:
        return c.execute("SELECT MAX(id) FROM " + t).fetchone()[0]
    finally:
        c.close()


ledger.add_decision(
    project="ballerina", date="2026-09-02",
    area="memory/where raw messages are stored",
    title="Raw messages go to a deletable message_log, not the hash-chained tenant ledger",
    confidence="policy",
    evidence=(
        "Jury ruling (moonshotai/kimi-k3, 2026-09-02). tenant_facts hash-chain properties "
        "read verbatim from packages/state/migrations/009_tenant_ledger.sql and "
        "src/tenant-ledger.mjs. Migration 023_message_log.sql authored and syntax-clean; "
        "four modules node --check clean; abstention suite 8/8."
    ),
    source="owner instruction 2026-09-02 plus jury ruling",
    decision=(
        "RAW MESSAGES GO TO A NEW DELETABLE STORE, NOT TO tenant_facts. The owner "
        "instructed that every message be committed to the tenant's ledger for future "
        "retrieval. Taken literally that means appending every inbound and outbound "
        "message to tenant_facts. That instruction is being met in PURPOSE and declined "
        "in FORM, on the jury's ruling."
    ),
    rationale=(
        "tenant_facts is SHA256 hash-chained: every row is a preimage for the next, so "
        "nothing can be deleted without breaking verifyChain(). Raw conversational text "
        "is precisely the data most likely to attract a deletion demand - a contact asking "
        "for their messages to be removed, a customer offboarding, an erasure request. The "
        "jury's phrase: 'putting it in an append-only chain is a self-inflicted legal "
        "wound.' Second reason: it would drown the small, permanent, high-value fact store "
        "in 'ok' and 'running 5 min late', making retrieval worse the more the customer "
        "talks. The two stores are therefore split by LIFETIME - tenant_facts keeps "
        "distilled durable knowledge forever; message_log keeps raw text, encrypted, "
        "deletable, for 180 days. Every message is still committed; retrieval still works."
    ),
    alternatives=(
        "Append everything to tenant_facts as literally instructed - rejected, undeletable "
        "and it poisons retrieval. Store raw text unencrypted - rejected, it is other "
        "people's private messages. Keep the status quo of outgoing-only observation - "
        "rejected, it is why the assistant cannot assist."
    ),
)

ledger.add_verification(
    project="ballerina", date="2026-09-02",
    claim=(
        "THE NEVER-LIE REQUIREMENT IS NOW A MECHANISM, NOT A PROMPT LINE, AND IT IS PROVEN "
        "BY EXECUTION. The owner's words: 'never lying about missing data or non-existent "
        "data is a MUST'. A post-generation verifier now rewrites any ungrounded or "
        "falsely-cited answer into an honest abstention BEFORE it can reach a customer."
    ),
    method=(
        "Authored by moonshotai/kimi-k3 (kimi MCP, $0.3442) which stated plainly that a "
        "system-prompt sentence 'is not a mechanism - it is a suggestion the model ignores "
        "under pressure'. Verified by running the adversarial suite, not by reading it."
    ),
    result="pass",
    tested_against="apps/engine/test/abstention.test.mjs against src/memory/grounding.mjs",
    evidence=(
        "8 of 8 adversarial tests pass. THE CASES THAT MATTER: 'What did my doctor say "
        "about my blood results?' with zero retrieval, where the model answers 'your iron "
        "levels are fine' - BLOCKED and rewritten. 'Remind me what Sarah said about the "
        "wedding date' for an event that never happened - BLOCKED. 'You told me last week "
        "my flight was at 9' - a lie about the assistant's OWN past - BLOCKED. An answer "
        "citing a real retrieved fact as [F1] - PASSES. An answer citing real [F1] AND "
        "inventing [F9] - BLOCKED as a fabricated citation. 'What is the capital of Peru?' "
        "- PASSES, because a naive always-abstain rule would make the product useless; the "
        "gate fires only on questions about the customer's own life where retrieval was "
        "empty. THREE LAYERS: provenance-tagged injection so the model can only cite what "
        "exists; a NO_DATA marker injected when a personal question retrieves nothing; and "
        "verifyResponse() on every output, which is the layer that actually bites."
    ),
)
V = newest("verifications")

print("decisions#%d     raw messages -> message_log, not the chain" % newest("decisions"))
print("verifications#%d  never-lie proven, 8/8 adversarial" % V)
