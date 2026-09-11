# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r"C:\Users\Magic\Desktop\env\mira-ledger")
import ledger

ledger.add_verification(
    project="ballerina", date="2026-08-30",
    claim=(
        "THE WHATSAPP MEMORY FIX IS AUTHORED, JUDGE-APPROVED AND STAGED. Not applied, not deployed. "
        "Every line came from the code-author MCP with deepseek/deepseek-v4-pro as author; the "
        "session agent wrote none of it and only assembled and verified the handover."
    ),
    method=(
        "Three separate code-author calls, one fragment each, against verbatim anchors read from the "
        "live file. The assembled handover was then dry-run against the real repository to prove "
        "every anchor matches exactly once."
    ),
    result="pass",
    tested_against="C:\\Ballerina-Motasadea-V1\\apps\\engine\\whatsapp-gateway-v2.mjs (read-only)",
    evidence=(
        "THE CHANGE, one file, three splices: (1) appendFact added to the existing @mira/state "
        "import; (2) a non-blocking recordFact helper that LOGS its failures; (3) two fact writes "
        "after each reply, mirroring telegram-bot.mjs:1199-1200 - one 'observation' with source "
        "'whatsapp' for the inbound text, one 'action'/'system' for the reply. Fire-and-forget, never "
        "awaited, so a ledger write can never delay a customer's reply. "
        "ANCHOR UNIQUENESS PROVEN BEFORE AUTHORING: the respond() call site appears once, the "
        "@mira/state import block once, the __dirname line once, and 'recordFact' appeared ZERO "
        "times in the file - nothing to collide with. Dry run confirmed 1/1/1. "
        "The handover also refuses to run twice: it aborts if the file already mentions recordFact. "
        "Handover: C:\\vualet-web\\docs\\Apply-WhatsAppMemory.ps1 - backs up, asserts anchors, "
        "node --check, restores the backup automatically on failure. It deliberately does NOT deploy "
        "or restart: the engine on 23.88.59.31 keeps forgetting until the owner ships it."
    ),
)
print("WA MEMORY STAGED ROW WRITTEN")
