# SESSION-LOG.md — Multi-agent coordination

Append-only log. Every Claude Code session (and human dev who wants to play
fair) writes a short entry **before they start touching files** and another
**when they push a branch**. This is the simplest way to keep parallel agents
from stepping on each other's commits.

## Protocol

1. **Before you start**, append an entry with:
   - timestamp (ISO-8601, UTC)
   - agent / dev name (something we can tell apart, e.g. `claude-code-sess-A` or `madjid`)
   - branch you're working on
   - files / globs you plan to touch (be honest; widen if you discover more mid-flight)
   - high-level intent (one sentence)
2. **When you push / open a PR**, append a follow-up entry with:
   - branch + PR URL (or "no PR yet")
   - what's locked vs still open
3. **Before you touch a file**, grep this log for that file:
   ```bash
   grep -E '^- files:.*<path>' docs/SESSION-LOG.md | tail -3
   ```
   If another active entry claims it, sync with that branch (rebase / wait /
   coordinate). If it's a stale completed entry, fine.
4. Never rewrite or delete entries — append only. Tag superseded info as
   `(superseded)` if you need to correct.

## Rules of engagement

- `main` and `develop` are protected. Branches off `develop` only.
- If two sessions need the same file at the same time:
  - The session that **started first** keeps it.
  - The session that arrives second either waits, rebases onto the first's
    branch when it lands, or scopes their work to avoid the conflict.
- `docs/` is the only place where small, additive edits without coordination
  are tolerated (separate files only — don't both edit the same doc).
- Never push to another agent's branch. If you have additions for it, open
  a PR into their branch and tag them.
- **DELIVER RULE: test every artifact before handing it to the user.**
  PowerShell scripts must pass `Parser::ParseFile` before telling the user
  to run them. Deployable files (`.ps1`, configs, APKs) must be verified
  via `curl -o /dev/null -w '%{http_code}'` from the public URL they ship
  from. If the user hits a parse error on something you gave them, that is
  a Claude failure, not a user error. Parse-check and download-check before
  reporting success. (Added 2026-06-19 after Unicode em-dash corruption in
  the Windows PS1 deliverable.)

---

## Active sessions

<!-- Append entries below this line, newest at the bottom. -->

### 2026-06-18 — claude-sess-mira-vpn — starting

- agent: `claude-code-sess-mira-vpn` (this session)
- branch: `feature/mira-vpn-storefront`
- files planned:
  - `src/lib/products.ts` (add `mira-vpn` entry)
  - `src/app/mira-vpn/page.tsx` (new landing page)
  - `src/app/mira-vpn/checkout/page.tsx` (new checkout entry page)
  - `src/app/api/webhooks/nowpayments/route.ts` (new webhook receiver)
  - `src/app/api/vpn/permit/route.ts` (new permit-issue endpoint)
  - `docs/SESSION-LOG.md` (this file — coordination only)
  - `docs/MIRA-VPN.md` (new product-spec doc)
- intent: Add Mira VPN as a Mira-suite product. Storefront / marketing / crypto
  checkout via NowPayments + permit issuance handoff to the Mira VPN backend
  (separate Hetzner box, provisioned in a parallel non-repo task). No edits to
  files owned by the existing `chore/governance-and-claude-md` work (CLAUDE.md,
  CONTRIBUTING.md, docs/BRAND.md, docs/CLOUD_AGENT_BRIEF.md, docs/CUTOVER.md,
  docs/MIRA.md, docs/USER_TODO.md, .githooks/) — those land via that PR first.
- note for other sessions: if you need to touch `src/lib/products.ts`,
  coordinate here before you start. It's the only shared file I'm changing.
