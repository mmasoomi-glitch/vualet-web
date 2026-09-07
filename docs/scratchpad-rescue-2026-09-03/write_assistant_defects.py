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


# ---------------------------------------------- 1. the autopilot hook, live
ledger.add_verification(
    project="claude-governance", date="2026-09-02",
    claim=(
        "THE REWIRED AUTOPILOT HOOK IS CONFIRMED WORKING IN LIVE USE, not merely in a "
        "harness. It fired on a real session stop and produced exactly the designed "
        "unbound behaviour: a generic continuation quoting NO project's recorded task."
    ),
    method=(
        "Observed in production use. The session runs in C:\\vualet-web, whose "
        ".autopilot-project binding was deliberately deleted after it was found to "
        "resolve BOUND and then quote a foreign task."
    ),
    result="pass",
    tested_against="live session stop, cwd C:\\vualet-web (unbound), hook sha 87d2007f3ed0bf60",
    evidence=(
        "The hook's own emitted text: 'Autopilot: continuable marker \"then i\" found. Your "
        "response named no project the canonical ledger recognises, so there is no recorded "
        "next step to follow. Continue with the next safe, local, reversible, evidence-backed "
        "piece of work you can do yourself... This is autopilot continuation 2 of 10.' "
        "THREE PROPERTIES CONFIRMED AT ONCE: (1) it correctly reported NO project rather "
        "than inventing one, in a session whose text is dense with the names ballerina, "
        "miravpn, filehub and vualet - under the old code that text would have selected a "
        "project and quoted its task; (2) it quoted NO next_action, which is the structural "
        "guarantee for unbound repositories; (3) the continuation budget is counting "
        "correctly at 2 of 10."
    ),
)
V_HOOK = newest("verifications")

# --------------------------------- 2. the assistant defects, all verified
ledger.add_gotcha(
    project="ballerina", date="2026-09-02",
    area="whatsapp / third-party inbound / memory - why the assistant cannot assist",
    symptom=(
        "The owner: 'on each message I get from family, [it] introduces itself instead of "
        "answering the message instead of me', and 'if he hasn't read my previous messages "
        "with friends and family, what kind of help can he provide as an assistant?'. Both "
        "complaints are correct and both are now located exactly in source."
    ),
    root_cause=(
        "THREE SEPARATE DEFECTS, each verified by reading the live code. "
        "(1) THE ADVERTISEMENT. whatsapp-gateway-v2.mjs, the identity gate: when "
        "gate.reason === 'onboarding_required' and the chat is a DM, the engine sends "
        "\"Hi! I'm Mira - a private AI assistant. To get started, sign up at "
        "mira.vualet.com and link your WhatsApp.\" The customer's own contacts are not "
        "tenants, so EVERY message from the customer's mother, doctor or employer receives "
        "a signup advertisement. There is NO RATE LIMIT on this branch and gateMessage does "
        "not throttle it either: five messages produce five identical adverts. "
        "(2) STAND-IN DOES NOT EXIST. whatsapp_consent defines the scope stand_in as 'Mira "
        "sends messages as the customer' and the pairing wizard collects it, but NO CODE "
        "ANYWHERE CONSUMES IT. There is exactly one persona in the system: 'You are Mira. "
        "You stand beside the customer like a brother'. No path composes a reply on the "
        "customer's behalf. The only third-party path is away-mode, which fires only when "
        "the customer explicitly enables it and sends a fixed cached template. "
        "(3) SHE HAS NEVER READ A SINGLE INBOUND MESSAGE. wa-observe.mjs gates on "
        "'if (!msg?.key?.fromMe) return false' - ONLY what the customer WROTE is observed. "
        "No inbound message from any contact is stored or read, ever. There is no history "
        "backfill, so nothing before consent exists. Observation yields at most 8 short "
        "distilled facts per sweep. The assistant therefore has no conversation thread as "
        "context for any relationship the customer has."
    ),
    fix=(
        "JURY RULINGS OBTAINED 2026-09-02 (kimi-k3, high reasoning). "
        "THE ADVERTISEMENT: remove immediately - 'there is no version of this worth "
        "keeping'. Silence becomes the default for third parties; away-mode template only "
        "when the customer enabled it; both rate-limited. "
        "REPLYING AS THE CUSTOMER: REJECTED, and the author declined to write it - 'the "
        "customer consented; the person on the other end did not'. Ratified instead is an "
        "OPENLY ATTRIBUTED assistant reply that answers usefully, discloses itself in its "
        "first clause, and never imitates the customer's voice. "
        "CONSEQUENCE THE OWNER MUST DECIDE: the signed disclosure text in whatsapp_consent "
        "currently PROMISES impersonation ('Mira sends messages as the customer'). If the "
        "attributed version ships, that policy_version text must be reworded, because it "
        "presently over-promises what the product will do. "
        "SCOPE CORRECTION: the first authored patch proposed a new thirdparty_rate_limit "
        "table and guessed column names away_mode / away_template / display_name. The real "
        "schema already provides tenants.auto_answer_enabled (default false), "
        "auto_answer_window_minutes (default 60, fail-closed on a corrupt timestamp), "
        "auto_answer_name (NULL by default) and auto_answer_templates_json, and "
        "wa-autoanswer.mjs already implements the decision gate, per-contact rate limit and "
        "per-language templates. The correct fix is therefore SMALL AND SURGICAL, not a new "
        "subsystem. Do not build a duplicate."
    ),
    evidence=(
        "whatsapp-gateway-v2.mjs identity-gate branch read verbatim, including the absence "
        "of any rate-limit call. wa-observe.mjs shouldObserve gate read verbatim. "
        "whatsapp_consent scope comment from migration 011_whatsapp_binding.sql. "
        "tenants.auto_answer_* columns from migrations 017 and 018. Per-contact rate limit "
        "confirmed present in wa-autoanswer.mjs autoAnswerDecision step 7."
    ),
    confidence="verified",
)

print("verifications#%d  autopilot hook confirmed live" % V_HOOK)
print("gotchas#%d        the three defects that stop Mira assisting" % newest("gotchas"))
