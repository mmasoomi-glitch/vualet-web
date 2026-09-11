# INCIDENT — Mira has been unreachable on WhatsApp since 2026-09-07

**Status: PARTIALLY RESOLVED 2026-09-11. Two defects fixed on production under
explicit owner instruction, which overrode the reviewer's "owner decides"
ruling.** Everything above the "What was fixed" section below was established
read-only, before anything was changed.

## What was fixed (2026-09-11)

Both changes are in `/opt/mira/apps/engine/whatsapp-gateway-v2.mjs` on host
`mira` (`23.88.59.31`). That file has **CRLF line endings** and a standing
warning against text-mode edits — an earlier text-mode round trip silently
converted 2,145 of them. Both patches were therefore applied in **binary mode
with a uniqueness assertion on every anchor**, and both verified `bare LF delta:
0`, `node --check` clean. Backups: `.bak-jidfix-20260911-151139` and
`.bak-logfix-20260911-151548`.

**FIX 1 — the reason the outage was permanent.** `startSession()` loaded
`tenant_id` from the database but never `account_jid`. The close handler decides
abandonment with `if (!s.accountJid && linkState !== 'ok')` — and its own comment
says *"a real customer whose phone dropped off wifi has an accountJid and must
still reconnect."* But `s.accountJid` was only ever populated on a successful
`connection: open`. With the credentials gone the session never opened, so three
genuinely-linked customers evaluated as *never linked* and were deleted from the
session map with no retry. The database knew better the whole time — all three
rows have `account_jid` **PRESENT**. `startSession()` now restores it from the
row before any close handler can judge.

Measured effect, before and after restart:

```
before:  {"ok":false,"linked":0,"total":0,"pending":0,"stale":0}
after:   {"ok":false,"linked":0,"total":3,"pending":3,"stale":0}
```

The three customers are **retained and recoverable** instead of discarded. A
60-second sample after the restart recorded **zero** registration attempts, zero
reconnect schedules and zero abandons — so this did **not** reintroduce the
reconnect storm that the abandonment logic was originally added to stop.

**FIX 2 — the reason nobody noticed for four days.** The
`auth state decrypted for tenant ...` log sat *outside* the `existsSync` guard
and printed even when zero files were found. It now counts what it actually
decrypted, returns `false` when that count is zero, and warns honestly. The same
boot now reports:

```
[wa-v2] NO auth files found in .../wss_589a3307becefa4c00c54d3a - session will present as NOT logged in
```

**STILL OUTSTANDING: `linked` is still 0.** The Baileys credentials themselves
are gone and could not be reconstructed — the Postgres `encrypted_auth` blobs do
not decrypt (see below). **The three customers must re-pair by scanning a QR
code.** The pairing flow is live and verified: `https://api.mira.vualet.com/pair`
returns 200.

## What a customer experiences

Mira does not answer on WhatsApp. She has not answered anyone since
**2026-09-07 05:47 UTC** — over four days. There is no error, no bounce, no
notification. Messages simply go nowhere.

The website is **not** affected and never was. Every route on `mira.vualet.com`
and `vualet.com` returns 200, and the site chat answers normally.

## The alarm that was already firing

`/opt/mira-ops/monitor.sh` on the web host has logged this every five minutes
since the outage began — **1212 alert lines** in `/var/log/mira-monitor.log`:

```
ALERT fails=1 mira_auth=ok api=FAIL(503) storefront=ok(200) marzban=ok ...
```

Last healthy line: `2026-09-07T05:37:26Z`. The monitor has been correct and
unheeded for four days. `api` is `https://api.mira.vualet.com/healthz`, which is
served by `mira-whatsapp` on port 8790 of the **second** VPS (host `mira`,
`23.88.59.31`) — not the web host. It returns:

```json
{"ok":false,"linked":0,"total":0,"pending":0,"stale":0}
```

`linked: 0`. No WhatsApp device is connected to Mira at all.

## What actually broke

**All 26 Baileys session directories under
`/opt/mira/apps/engine/.wa-customer-sessions` are completely empty** — `find`
reports **zero files** across all of them. Baileys keeps `creds.json` and its key
files there; with them gone there is no linked device. Directory mtimes cluster
at **2026-09-07 05:44**, two minutes before the service restarted at 05:46:51.
There is no backup of that directory anywhere on the filesystem.

The gateway process is `active` and has **not** restarted since
(`NRestarts=0`), but `/var/log/mira-whatsapp.log` has not been written since
**05:49 on 2026-09-07**. It is running and silent.

## Why it never recovered — three compounding faults

The last entries in the log show the whole failure in sequence:

```
[wa-gw] boot rehydrate: resuming wss_589a3307becefa4c00c54d3a
[wa-v2] auth state decrypted for tenant tnt_6f0611074ddefcff
[wa-baileys] info connected to WA
[wa-baileys] info not logged in, attempting registration...
[wa-baileys] info connection errored
[wa-v2:wss_...] pairing abandoned (link expired, never linked) - not reconnecting
```

**1. The restore path only reads disk, and disk was empty.**
`decryptAuthState(tenantId, authDir)` iterates `['creds.json']`, and every step
is inside `if (existsSync(path))`. With the files deleted there was nothing to
restore. It never consults the database.

**2. It reports success even when it restored nothing.** The line
`console.log('[wa-v2] auth state decrypted for tenant ...')` sits *outside* the
`existsSync` guard, so it prints whether or not a single byte was decrypted.
That false success is why the log looks like recovery worked when it did
nothing, and it is the single most misleading line in this incident.

**3. The failure is misclassified as "never linked", which disables retry.**
Baileys, given no credentials, does the only thing it can — attempts a fresh
registration, which fails. The gateway then labels these long-standing customer
links `pairing abandoned (link expired, never linked) - not reconnecting` and
stops. **There is no retry, no backoff, and no alert.** That is why four days
passed in silence.

## What might still be recoverable

`whatsapp_sessions` has an `encrypted_auth` column, and three rows still hold
one. This is a **separate** store from the deleted disk files:

| session | tenant | kek | bytes | last connected |
|---|---|---|---|---|
| `wss_d6dfc25a12ca94deab017759` | `tnt_643a07b0fe36d215` | v1 | 4797 | 2026-09-05 20:50:35Z |
| `wss_589a3307becefa4c00c54d3a` | `tnt_6f0611074ddefcff` | v1 | 5029 | 2026-09-05 20:38:05Z |
| `wss_2a554892373ea97982df6553` | `tnt_1d1f7892d112ecfb` | v1 | 5009 | 2026-09-05 19:42:29Z |

The other 20 rows are `provisioned` with `encrypted_auth` NULL — they never
completed linking and were never live.

**But the blob did not decrypt.** `ops/wa-rehydrate-dryrun.mjs` reports
`kekConfigured: true` and then `decrypt()` fails with:

```
Unsupported state or unable to authenticate data
```

That is an AES-GCM authentication-tag failure. **I have not established why**,
and it should not be assumed the key rotated. The plausible explanations, none
confirmed:

- `CONTENT_KEK` differs from the key that wrote those rows;
- the DB blob uses a different framing or AAD than the on-disk format that
  `decrypt(tenantId, stored)` expects, so the call shape is wrong;
- the rows were written by an older encryption scheme than `kek_version = v1`
  implies.

Until that is resolved, treat these three as **possibly** recoverable, not
recoverable.

## Open questions for the owner

1. **What invoked `revokeSession()` 26 times on 2026-09-07 around 05:44?** It is
   the only code that deletes exactly `creds.json`, `app-state-sync-key.json`
   and `app-state-sync-version.json`. Its default reason is `customer_request`.
   Was this deliberate, a deploy step, or a bug? Restoring before knowing risks
   being undone immediately.
2. **Is `CONTENT_KEK` today the same value it was on 2026-09-05?**
3. **Restoring these credentials means handling third-party WhatsApp
   credentials** for a customer-owned Baileys setup governed by jury
   `decisions#288`. That is the owner's call, not an operator's.

## Recommended fixes, independent of recovery

- Move the `auth state decrypted` log line inside the `existsSync` guard, or
  make it report how many files it actually decrypted. A success message that
  fires on a no-op hid this for four days.
- Do not classify a session that has `last_connected_at` set as
  `never linked`. A previously-connected session failing to resume is an
  **incident**, not an expired pairing, and must retry with backoff and alert.
- Back up `.wa-customer-sessions`, or make the database the authoritative store
  and the directory a true cache that can be rebuilt.
- Route the existing monitor's `api=FAIL` somewhere a human sees. It worked
  perfectly and nobody was watching.
