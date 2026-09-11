# -*- coding: utf-8 -*-
"""Write today's measured findings to the canonical ledger.

Every claim below was produced by RUNNING something today, not by reading.
Row ids are captured after each insert so the state row can cite them, which
add_state requires (R4-7, decisions#294) for a RUNTIME VERIFIED stage.
"""
import sqlite3
import sys

sys.path.insert(0, r"C:\Users\Magic\Desktop\env\mira-ledger")
import ledger  # noqa: E402

DB = r"C:\Users\Magic\Desktop\env\mira-ledger\ledger.db"


def newest(table):
    c = sqlite3.connect("file:" + DB.replace("\\", "/") + "?mode=ro", uri=True, timeout=5)
    try:
        return c.execute("SELECT MAX(id) FROM " + table).fetchone()[0]
    finally:
        c.close()


# ---------------------------------------------------------------- 1. crisis
ledger.add_verification(
    project="ballerina", date="2026-09-02",
    claim=(
        "THE #1 RANKED SALES BLOCKER IS ALREADY FIXED AND DEPLOYED. state#105 "
        "(2026-08-23) ranks crisis detection being ENGLISH-ONLY as the most severe "
        "blocker, stating the phrase 'I want to die' fires in English and 0 of 4 in "
        "Urdu, Hindi, Persian and Arabic. That is STALE. The production engine now "
        "carries three crisis patterns - CRISIS_EN, CRISIS_NATIVE (Arabic, Urdu, "
        "Persian, Devanagari) and CRISIS_ROMAN (Latin-typed Urdu/Hindi/Arabic/"
        "Tagalog) - and the repo's own test suite passes 7 of 7 against the "
        "PRODUCTION file, not the local one."
    ),
    method=(
        "The deployed file was pulled down from the engine host read-only via scp and "
        "the repository's existing test/safety-crisis.test.mjs was run against THAT "
        "file, so the assertions exercised production bytes rather than the local "
        "working copy. No write of any kind was made to the production host."
    ),
    result="pass",
    tested_against="/opt/mira/apps/engine/src/safety.mjs on engine host 23.88.59.31",
    evidence=(
        "7/7 pass against the production file: 'the original English detections all "
        "still fire'; 'native-script disclosures fire in all four languages'; "
        "'inflected and orthographic variants fire too'; 'romanised disclosures fire'; "
        "'ordinary greetings never fire in any script'; 'the hotline text is pinned and "
        "unaltered'; 'the reply is compassionate and non-empty for every language "
        "probe'. duration 68ms. "
        "PROVENANCE OF THE FILE COMPARED: local sha256 ed7483cb60c2bc02, live "
        "9f7b0e75785dbc96. The difference is LINE ENDINGS ONLY - local 4832 bytes with "
        "0 CRLF, live 4909 bytes with 77 CRLF, and the two are byte-identical once "
        "line endings are normalised. So the live engine is running exactly the "
        "reviewed source. "
        "The source itself records the deliberate scope split: the crisis REPLY and "
        "the HOTLINES text remain in English on purpose, because translating emergency "
        "guidance and adding regional hotline numbers is OWNER work - a wrong "
        "emergency number could get someone killed. Detection widening (done) and "
        "reply translation (not done, owner-only) are separate concerns."
    ),
)
V_CRISIS = newest("verifications")

# ------------------------------------------------------------- 2. storefront
ledger.add_verification(
    project="ballerina", date="2026-09-02",
    claim=(
        "THE #2 RANKED SALES BLOCKER IS ALSO FALSE. state#105 states '17 of 24 sitemap "
        "URLs return 404 on the apex domain, including /legal/refund, /legal/privacy, "
        "/legal/terms, /pricing and all seven /products/*'. Measured today: the sitemap "
        "advertises 45 URLs and ALL 45 return HTTP 200, the named legal and pricing "
        "pages among them."
    ),
    method=(
        "Every <loc> in https://vualet.com/sitemap.xml was fetched over the public "
        "internet and its status code recorded; then the five specific paths named in "
        "state#105 were fetched individually."
    ),
    result="pass",
    tested_against="https://vualet.com/sitemap.xml over the public internet",
    evidence=(
        "45 URLs advertised, 200 OK on 45, broken 0. Individually: /pricing 200, "
        "/legal/refund 200, /legal/privacy 200, /legal/terms 200, /products/mira 200. "
        "CORRECTION TO MY OWN EARLIER CLAIM IN THIS SESSION: I reported /products/vpn "
        "and /products/filehub as 404s. They are paths I guessed, not real routes - "
        "nothing in the repository links to them and no file route defines them (the "
        "site is a Next.js src/app tree). They are not defects and must not be "
        "recorded as such."
    ),
)
V_STORE = newest("verifications")

# --------------------------------------------- 3. the identification layer
ledger.add_verification(
    project="claude-governance", date="2026-09-02",
    claim=(
        "THE PROJECT-DRIFT FIX IS INSTALLED AND PROVEN BY EXECUTION. The replacement "
        "identification layer for the autopilot Stop hook resolves a session's project "
        "from an EXPLICIT per-repository binding file, and where none exists falls back "
        "to a prevalence count over the whole transcript that must clear a margin rule "
        "or stay silent. It is installed at "
        "C:\\Users\\Magic\\.claude\\hooks\\project_identity.py."
    ),
    method=(
        "Authored by moonshotai/kimi-k3 at high reasoning effort (kimi MCP, session "
        "kimi_d502c20ae821, $0.4579) after the code-author MCP failed twice; then "
        "judged by EXECUTION against the real ledger and this session's real 50.5 MB "
        "transcript, not by review. Installed by the owner in an attended PowerShell "
        "run because the P0-W2 guard correctly refused an agent write into ~/.claude."
    ),
    result="pass",
    tested_against="C:\\Users\\Magic\\.claude\\hooks\\project_identity.py sha256 47e005e1ffee56396e25dda469889b1df43927e83dd96aee3b9c15dc86c59d8e",
    evidence=(
        "py_compile clean. READ-ONLY FENCE PROVEN, not assumed: an attempted CREATE "
        "TABLE through its own connection was refused with OperationalError. "
        "BINDING WALK: five real directories all resolved correctly, and the walk "
        "STOPPED at the .git root rather than climbing into the home directory - the "
        "property that stops a parent-folder binding capturing sibling checkouts. "
        "THE DECISIVE TEST: run against this session's real transcript (50.5 MB, "
        "scanned in 0.50s) the tally was ballerina 39, Vualet suite 31, FileHub 17, "
        "Veridian 10. Ratio 1.26 is under the 2.0 floor, so the verdict was SILENCE "
        "and the end-to-end decision was STOP ALLOWED. That is the correct answer: the "
        "session genuinely IS mixed, and the margin rule refused to guess. "
        "POST-INSTALL, against the owner's own bindings: C:\\vualet-web resolves BOUND "
        "to key 'vualet' and C:\\Ballerina-Motasadea-V1 BOUND to key 'ballerina', each "
        "quoting its own project's recorded next action. "
        "DISCLOSED DEVIATION FROM THE AUTHORED CODE: the BOUND-but-no-ledger-row branch "
        "printed ident.detail where a project key belonged, so its message would have "
        "read \"bound to project key 'bound via C:\\...'\". I added a project_key field "
        "to the Identification record and used it - two lines, authored by me, not by "
        "kimi, and flagged rather than buried. "
        "TRANSPORT DEFECT WORTH KNOWING: the authored code arrived through the MCP "
        "result with &gt; and &lt; in place of > and <. Applied verbatim it would not "
        "have parsed. It was unescaped during transcription."
    ),
)
V_HOOK = newest("verifications")

# ------------------------------------------------- 4. the code-author gotcha
ledger.add_gotcha(
    project="code-author-mcp", date="2026-09-02",
    area="code-author / author stage / empty completion",
    symptom=(
        "code-author's author_code returned status 'error' with an empty code_body "
        "twice in a row, note 'Upstream failure: moonshotai/kimi-k3 returned an empty "
        "completion'. The intent stage succeeded both times. The second run still cost "
        "$0.036 because the free intent model was overloaded and fell back to "
        "google/gemini-2.5-flash, so the failure is not free."
    ),
    root_cause=(
        "NOT an outage and NOT an egress block - both were checked and excluded. "
        "openrouter.ai returned HTTP 200 in 1.2s by name, the hosts file was clean of "
        "the veridian-egress entries, and moonshotai/kimi-k3 is listed, live and priced "
        "on OpenRouter with a 1,048,576-token context. "
        "INFERRED, and strongly supported by measurement: kimi-k3 is a reasoning model, "
        "and an empty content string on an otherwise successful call is the signature "
        "of the reasoning budget consuming the entire max_tokens allowance before any "
        "answer is emitted. The kimi MCP exposes max_tokens with a DEFAULT OF 8000. The "
        "identical dossier, sent through the kimi MCP with max_tokens raised to 32000, "
        "returned a complete ruling plus ~500 lines of code using 19,770 output tokens "
        "- more than twice the 8000 default. A cap at or near 8000 cannot hold this "
        "model's output for a non-trivial dossier."
    ),
    fix=(
        "PROPOSED, owner-attended: raise the author-stage max_tokens in the code-author "
        "MCP configuration well above 20000 for kimi-k3, or route sophisticated dossiers "
        "to the kimi MCP directly with an explicit max_tokens. WORKAROUND USED TODAY and "
        "verified: mcp__kimi__kimi_author with max_tokens=32000 and reasoning_effort=high, "
        "with the caller judging the output rather than the pipeline's own judges. "
        "SECONDARY: the intent stage's free model nvidia/nemotron-3-super-120b-a12b:free "
        "returned 'Service temporarily overloaded' and fell back to a paid model. If it "
        "has been de-listed, CA_INTENT_MODEL should be pointed at a live free model."
    ),
    evidence=(
        "Two consecutive author_code runs, 2m39s and 2m48s, both status error with "
        "empty code_body and the same upstream note. OpenRouter /api/v1/models lists "
        "moonshotai/kimi-k3 at prompt $0.000003 / completion $0.000015 per token, "
        "context 1048576. The successful kimi MCP run reported 2901 in / 19770 out, "
        "$0.4579."
    ),
    confidence="verified",
)

# ------------------------------------------------------------- 5. state row
ledger.add_state(
    project="ballerina", date="2026-09-02",
    stage="RUNTIME VERIFIED (crisis detection multilingual ON THE LIVE ENGINE, verifications#%d)" % V_CRISIS,
    deploy_location="engine host 23.88.59.31; https://api.mira.vualet.com",
    blockers=(
        "SUPERSEDES state#105. Two of its five ranked sales blockers were measured today "
        "and are DEAD; do not act on them again. "
        "(1) CLOSED - 'crisis detection is ENGLISH-ONLY, fires 0 of 4'. The live engine "
        "carries CRISIS_EN, CRISIS_NATIVE (Arabic, Urdu, Persian, Devanagari) and "
        "CRISIS_ROMAN, and the repo's own suite passes 7/7 against the PRODUCTION file "
        "(verifications#%d). "
        "(2) CLOSED - '17 of 24 sitemap URLs return 404'. All 45 advertised URLs return "
        "200, including /pricing and all three legal pages (verifications#%d). "
        "WHAT ACTUALLY BLOCKS SALES NOW. "
        "(A) OWNER-ONLY, and the real one: NOBODY HAS EVER PAID. The Dodo path is "
        "code-complete and tested but no money has moved and no webhook has ever "
        "arrived. One real card purchase followed by a refund settles it. "
        "(B) OWNER-ONLY: the four capability items are deployed but have never been "
        "exercised by a real phone. "
        "(C) AGENT-DOABLE, the only one left: web search has no backend configured, so "
        "it correctly reports itself unavailable rather than inventing answers. Honest, "
        "but not sellable. "
        "(D) OWNER-ONLY, unchanged: rotate SEARCH_API_KEY; set MIRA_BILLING_PUSH_SECRET "
        "to the same value on engine and web, or revocation lags. "
        "(E) SAFETY, DELIBERATELY NOT DONE BY AN AGENT: the crisis REPLY and hotline "
        "numbers remain English on purpose. Translating emergency guidance and adding "
        "regional numbers is owner work - a wrong emergency number could get someone "
        "killed."
    ) % (V_CRISIS, V_STORE),
    next_action=(
        "AGENT: configure the web-search backend - the last remaining agent-doable sales "
        "blocker. OWNER: run ONE real card payment end-to-end and refund it, then "
        "exercise the four capabilities from a real phone (type, voice note, a "
        "calculation, a photo of text). Do NOT re-open crisis-detection language "
        "coverage or the storefront 404s; both were measured dead on 2026-09-02."
    ),
    evidence=(
        "verifications#%d (crisis, 7/7 against the production file) and "
        "verifications#%d (45/45 sitemap URLs 200). Both measured today by execution "
        "against live systems, not by reading source or trusting a prior row."
        % (V_CRISIS, V_STORE)
    ),
)

print("verifications#%d  crisis detection multilingual, live" % V_CRISIS)
print("verifications#%d  storefront 45/45 200" % V_STORE)
print("verifications#%d  project_identity installed and judged" % V_HOOK)
print("gotchas#%d        code-author empty completion" % newest("gotchas"))
print("state#%d          ballerina, superseding state#105" % newest("state"))
