# Reliability runbook

An alert with no remediation step is noise, and noise trains people to ignore
the channel — which recreates the silent four-day outage this whole subsystem
was built to prevent. So: what each alert means, and what you do about it.

Alerts arrive at **support@vualet.com** with subject `[SEVERITY] service: title`.

---

## First 60 seconds

1. Read the **service** and **severity** from the subject: `[CRITICAL] whatsapp: whatsapp OFFLINE`.
2. `GET /api/ops/health` — overall state, every tracker, recent alerts. Needs admin auth (`health.read`).
3. Look at the service's `lastError`. That string, not the title, tells you what actually broke.
4. `GET /api/ops/incidents` — is this new, or has it been open for hours?
5. Only then act. **Do not restart `mira-web` as a first move**: it resets every tracker and you lose the state that tells you what happened.

---

## `whatsapp OFFLINE` — error `no linked devices`

**This is the four-day outage signature.** The gateway process is alive, the port
answers, and `linked: 0` — every customer is disconnected.

**It does NOT mean the gateway is down.** It is running and empty. A liveness
check would call this healthy; that is exactly how it went unnoticed before.

**It is NOT excused by `channelRecovery: NOT_INTEGRATED`.** Those are unrelated.
`NOT_INTEGRATED` means the *automatic* reconnect loop is not wired yet. `linked: 0`
is a real outage either way.

```bash
curl -s http://127.0.0.1:8790/healthz    # on the prod host: the raw counts
```

- `linked: 0`, `total: 3` → three customers disconnected. **Real.**
- `linked` > 0 → recovered; the alert was a transient and will clear.
- Endpoint unreachable → the probe now tells you **which side**. Read
  `detail.layer` and `detail.guidance` on the failing tracker:
  - `tunnel down` / `layer: transport` → nothing is listening on 127.0.0.1:8790
    on **this** host. The gateway may be perfectly healthy. Restart the tunnel here.
  - `gateway unreachable` / `layer: gateway` → the tunnel is up and forwarding;
    the **far** host is not answering. Go to the gateway host.
  - `timeout` / `layer: unknown` → genuinely ambiguous. Check both.

**Remediation:** customers must re-scan a QR. **Nobody can reconnect them
remotely.** Point them at `https://mira.vualet.com/mira/reconnect`.

**Standing condition as of 2026-09-12:** `linked:0 / total:3`. Three customers are
already in this state. Do not treat a repeat alert as new information without
checking `GET /api/ops/incidents` for the incident id.

---

## `inference: credit exhausted`

**The assistant is still answering** — and has silently dropped to its knowledge
base, so it can no longer reason. Customers see a duller assistant, not an error.

This is the one alert that arrives *before* anything visibly breaks. Act on it.

**Remediation:** top up the OpenRouter balance. **Owner decision** — it is money.
No code change, no restart.

A `high` severity version fires *before* zero, at `remaining <= 1`. That is your
warning shot.

---

## `inference` — `invalid key` / `no api key`

- `invalid key` — **their** side rejected our credential: revoked, wrong, expired.
- `no api key` — **our** side has no `OPENROUTER_API_KEY` in `runtime.conf`. The
  probe deliberately makes no request in this case so you are not sent to
  investigate the provider for our own missing config.

```bash
grep -c OPENROUTER_API_KEY /opt/mira-web/runtime.conf   # 0 means unset
```

**Remediation:** key rotation is an **owner decision**. After changing
`runtime.conf`, `systemctl restart mira-web`.

---

## `inference: unrecognised key payload`

The provider changed its response schema. The probe refused to guess and failed
loudly rather than quietly degrading into a liveness check that could never
detect credit exhaustion again.

**This is our bug to fix, not the provider's.** The probe's `detail.fields` lists
the top-level key names it actually saw — map those to the new schema in
`ops/reliability/probes.mjs`.

```bash
grep 'unrecognised key payload' /opt/mira-web/data/reliability.jsonl | tail -1
```

---

## `assistant: empty reply`

The route answered but produced no words — a proxy error page, a broken route,
or an upstream returning an error body with a 200.

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3021/    # is the app up?
journalctl -u mira-web --since '10 min ago' | grep -i veridian
```

Force an immediate re-check rather than waiting for the poll:

```bash
curl -X POST -H 'Content-Type: application/json' -d '{"service":"assistant"}' \
  https://mira.vualet.com/api/ops/services      # needs admin auth
```

---

## `timeout` (any service)

One is not an incident. The probe allows 8s.

Real if: it repeats, or the tracker reaches `OFFLINE`. Check host load and
`journalctl` before touching anything.

---

## `ALERT NOT DELIVERED` in the logs

```
[reliability] ALERT NOT DELIVERED (send_failed): whatsapp OFFLINE
```

**The alarm itself is broken.** Something failed and nobody was told. Check
`MIRA_ALERT_EMAIL` is set and SMTP is reachable. A failed send is not recorded as
sent, so it will retry — but until it succeeds you are blind.

---

## What is NOT an emergency

- **`info` alerts** (`... restored`) are never emailed at all. If you see one in
  the log as `alert suppressed (severity_below_threshold)`, that is correct.
- **A single `DEGRADED` that returns to `HEALTHY`.** One failed probe degrades;
  three consecutive successes restore. Self-healing is the system working.
- **`alert suppressed (deduped)`** — the same alert within 15 minutes. Working
  as intended.
- **`channelRecovery: NOT_INTEGRATED`** — a known, documented gap
  (`docs/ENGINE-CHANNEL-CONTRACT.md`), not a new failure. It does not excuse any
  other alert.

---

## Reading `data/reliability.jsonl`

Append-only, one JSON object per line, on the prod host at `/opt/mira-web/`.

```bash
# The last 10 state changes and alerts, readable:
tail -40 /opt/mira-web/data/reliability.jsonl | python3 -c "
import sys, json
for line in sys.stdin:
    e = json.loads(line)
    d = e.get('detail') or {}
    print(f\"{e['atMs']} {e['service']:10s} {e['type']:11s} \"
          f\"{e.get('state') or '':12s} {e.get('reason') or d.get('title','')}\")
"
```

Identifiers are redacted on write — you will never find a phone number here, by
design. `incidentId` correlates the events of one incident.

---

## Escalation

| Situation | Who |
|---|---|
| Credit top-up, billing | **Owner** — it is money |
| API key rotation | **Owner** — it is a credential |
| WhatsApp customers disconnected | Nobody can fix remotely; they must re-scan |
| Gateway host / SSH tunnel down | Gateway host — a **separate project** |
| `channelRecovery: NOT_INTEGRATED` | Engine team; see `docs/ENGINE-CHANNEL-CONTRACT.md` |
| Probe or schema bug | **Us.** `ops/reliability/` |
