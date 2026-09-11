# CODEX TASK — deploy the Mira engine (WhatsApp pairing + revocation)

Self-contained. You have no access to the conversation this came from, so everything you need
is below. Facts are VERIFIED unless marked INFERRED or UNKNOWN. Treat UNKNOWN as something to
**establish**, never to assume.

---

## 1. Why this matters

Customer signup is **dead in production right now**. The web app's `/api/begin` returns
`503 whatsapp_unavailable`, because the two halves of WhatsApp pairing were never connected:
the web app expected a page that accepts a *connect token*, while the engine gateway only had
`POST /pair/request`, which is server-to-server and demanded an already-existing `tenantId`.

Both halves are now written and tested. **You are deploying the engine half only.** The web
half is deployed separately by an agent that holds that host's key and does not hold this
one's.

Nothing customer-facing is flipped by you. Getting the engine up, healthy and answering
correctly is the entire task.

---

## 2. Two hosts — confirm which one you are on before every write

| | Host | Role | Yours? |
|---|---|---|---|
| **YOURS** | `23.88.59.31` | engine: Postgres, WhatsApp gateway, Telegram bot | **yes** |
| NOT yours | `89.167.49.209` | web app, nginx, Cloudflare edge | no — someone else |

Deploying engine code onto the web host, or the reverse, is the worst mistake available here.

**Engine paths (VERIFIED from the project runbook):**

- Checkout: `/opt/mira`
- Services: `mira-whatsapp.service` (gateway), `mira-bot.service` (Telegram)
- Gateway binds **`127.0.0.1:8790` only** — deliberately not publicly reachable
- Gateway log: `/var/log/mira-whatsapp.log`
- Secrets: `/etc/mira/mira-whatsapp.env`, **root:root, mode 0600**, loaded by *both* services
  (`mira-bot` via drop-in `/etc/systemd/system/mira-bot.service.d/wa.conf`)
- Rollback tag in `/opt/mira`: **`pre-wa-v2` = `54dbefa`**
- Existing DB backup: `/root/backups/mira-pre-wa-v2-20260815-112059.sql.gz`

---

## 3. The code

- Repo: `mmasoomi-glitch/Ballerina-Motasadea-V1`
- Branch: **`remediation/wa-connect-pairing`**
- Commit: **`242d0fd`**

**UNKNOWN — establish before planning delivery:** whether `/opt/mira` has a git remote that can
reach GitHub, and whether it has credentials for the repo. The runbook records `/opt/mira` as a
git checkout that was at commit `f39bd5d`, but its remote configuration was never verified.
Start with:

```
git -C /opt/mira remote -v
git -C /opt/mira status
```

If there is no usable remote, deliver the tree by whatever means you do have — but **never
rsync or scp over `/opt/mira` in place**. Stage beside it and swap, so a failed transfer cannot
leave a half-written service directory.

---

## 4. Preconditions

1. `git -C /opt/mira status` — record the commit, and whether the tree is dirty. **If someone
   has edited files in place on the server, stop and report it** rather than discarding work.
2. `git -C /opt/mira rev-parse pre-wa-v2` resolves. If not, you have no cheap rollback — say so
   before proceeding.
3. `systemctl is-active mira-whatsapp mira-bot` — record the starting state.
4. `stat -c '%a %U:%G' /etc/mira/mira-whatsapp.env` — expect `600 root:root`, and preserve
   exactly that after editing.

---

## 5. Environment

Add to `/etc/mira/mira-whatsapp.env`, preserving `0600 root:root`.

**Required, new** (the engine now calls back into the web app to claim a token):

- `MIRA_WEB_URL=https://mira.vualet.com`
- `MIRA_BIND_SECRET` — **DO NOT ask anyone to send you this value. This host already has it.**

  VERIFIED: `apps/engine/telegram-bot.mjs:420` sends
  `'x-mira-bind-secret': process.env.MIRA_BIND_SECRET`, and the Telegram bind path works in
  production today — so the value is already present in the environment that
  `mira-bot.service` loads. The new gateway code reads the same variable
  (`apps/engine/whatsapp-gateway-v2.mjs:1518`).

  Your job is therefore **not** to obtain a secret, but to make `mira-whatsapp.service` see the
  one that already exists. Find which env file or drop-in supplies it to `mira-bot.service`
  (start with `systemctl show mira-bot -p EnvironmentFiles` and
  `/etc/systemd/system/mira-bot.service.d/`), then either point the gateway at the same file or
  copy the assignment across. Copy it **without printing it** — e.g.
  `grep '^MIRA_BIND_SECRET=' <source> >> /etc/mira/mira-whatsapp.env` — then re-assert
  `chmod 600` and `chown root:root`, and confirm it appears exactly once.

  **Cross-check (cheap, do it):** the web host's value digests to `7ba431915e10` — the first 12
  hex of its SHA-256 with the trailing newline stripped. Compute the same here and compare, per
  §8. A mismatch means the two services will never authenticate to each other; that is a real
  finding to report, not something to paper over.

**Optional, new** (defaults are fine; set only to override):

- `WA_CONNECT_TOKEN_TTL_MS` — default 24h
- `WA_BIND_TIMEOUT_MS` — default 8000

**Already present — do not regenerate, do not print:**

- `WA_PROVISION_SECRET` — bearer secret for `POST /pair/request`
- `WA_GATE_TOKEN` — compared against the exposure approval flag
- `WA_WEB_PORT`, `WA_PUBLIC_BASE`

---

## 6. Deploy

1. Check out `242d0fd` in `/opt/mira`.
2. `npm ci` if `package-lock.json` changed.
3. `systemctl restart mira-whatsapp`
4. `systemctl restart mira-bot` (shares the env file via the drop-in)

**Do not run any database migration by hand.** `ensureSchema()`
(`packages/state/src/db.mjs:57-66`) reads every `.sql` in `packages/state/migrations/` and
executes it on **every** startup. `014_wa_connect_pairing.sql` applies itself on restart.

---

## 7. Verification — prove it

```
systemctl is-active mira-whatsapp           # expect: active
systemctl show mira-whatsapp -p NRestarts   # expect: NRestarts=0
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8790/pair/request
```

The curl must return **`401`**. That is healthy: the endpoint is authenticated and fail-closed,
and you sent no bearer token.

- **`503`** means the exposure interlock is refusing (`not_switched_on`) — the approval flag and
  `WA_GATE_TOKEN` disagree. **Report it; do not "fix" it by writing the flag.**
- **Connection refused** means the gateway is not listening → §9.

Then confirm the schema actually changed (read-only queries):

| object | expected |
|---|---|
| `whatsapp_sessions.tenant_id` | `is_nullable = YES` |
| `whatsapp_bindings.tenant_id` | `is_nullable = YES` |
| `tenants.telegram_id` | `is_nullable = NO` — **must not have changed** |
| index `idx_whatsapp_sessions_connect_token` | exists, on `whatsapp_sessions (connect_token_hash) WHERE connect_token_hash IS NOT NULL` |

That partial unique index enforces single-use pairing **at the database level**, not in
application code. If `tenants.telegram_id` became nullable, something altered a table it must
not have — **stop and report**.

---

## 8. The two shared secrets

`WA_PROVISION_SECRET` and `MIRA_BIND_SECRET` must match **byte for byte** across the two hosts.
No agent pastes a secret value into a prompt, a log, or a report.

**Neither secret needs to be transported.** Both already exist on this host — see §5 for
`MIRA_BIND_SECRET`, and `WA_PROVISION_SECRET` is already in `/etc/mira/mira-whatsapp.env`. The
only thing in question is whether they *match* the web host, which a digest answers without
either side revealing anything.

**Known web-host digests, for comparison:**

| variable | web-host digest (first 12 hex of SHA-256) |
|---|---|
| `MIRA_BIND_SECRET` | `7ba431915e10` |

Use a digest handshake. On this host:

```
sha256sum <<< "$WA_PROVISION_SECRET" | cut -c1-12
sha256sum <<< "$MIRA_BIND_SECRET"    | cut -c1-12
```

Report **only those 12-character prefixes**. The other agent computes the same on the web host
and compares. If they differ, every call between the services will `401`.

If you also hold the web host's key, set both sides yourself and skip the handshake — but still
report digests only.

---

## 9. If the service will not start — look here first

`ensureSchema` runs every migration inside a bare `await db.query(ddl)` loop with **no
try/catch**. One failing migration throws during startup and takes down the **entire engine —
the WhatsApp gateway *and* the Telegram bot**, not just the new feature.

```
journalctl -u mira-whatsapp -n 100 --no-pager
```

**VERIFIED:** all 14 migrations, including `014`, apply cleanly to a fresh PostgreSQL 16
database and are idempotent across three consecutive full re-runs. So a failure here is
**environmental** — permissions, a Postgres version difference, or a pre-existing row that
violates a new CHECK — and **not** a syntax error. Report the actual error text; do not edit
the migration.

---

## 10. Rollback and kill switch

Rollback:
```
systemctl stop mira-whatsapp
cd /opt/mira && git checkout pre-wa-v2 -- .
systemctl restart mira-bot
```

Kill switch — stops all pairing and message handling in seconds, leaves Telegram working:
```
systemctl stop mira-whatsapp
```

---

## 11. Prohibitions

- No manual migrations.
- **Never `ALTER TABLE tenants`** in any form. An earlier migration explicitly forbids it and
  the current design depends on that column staying `NOT NULL`.
- Do not regenerate `WA_PROVISION_SECRET` or `WA_GATE_TOKEN` — the other side already has them.
- Never print, echo, log or report a secret value. Digests only.
- Do not write the exposure approval flag.
- Do not expose port 8790 publicly. It binds loopback by design; the public path is an SSH
  tunnel from the web host.
- Do not touch `89.167.49.209`.
- No force-push, and do not commit anything from the server.

---

## 12. Report back

1. The commit `/opt/mira` was on **before**, and after.
2. `is-active` and `NRestarts` for both services.
3. The exact status code from the `/pair/request` probe.
4. The four schema values from §7, and whether the partial unique index exists.
5. The two 12-character secret digests.
6. **Anything that contradicts this document.** That is the most valuable thing you can return:
   this brief was written from a runbook and from source reading, **not** from the live machine,
   and several items in it were never verified against that host.
