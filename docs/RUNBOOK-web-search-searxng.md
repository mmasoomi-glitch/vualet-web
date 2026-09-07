# RUNBOOK — turn on web search for Mira (self-hosted SearXNG)

Prepared 2026-09-02. Owner-executed: every step below touches the production
engine host, so none of it is agent work.

Closes blocker (C) of `state#180` — the last remaining item on that list that
is not a card payment or a phone test.

---

## Why SearXNG and not Serper

The engine already supports both backends; `builtins.mjs` picks between them by
configuration alone, and **no code change is needed for either**.

| | SearXNG (recommended) | Serper |
|---|---|---|
| Marginal cost per query | zero | paid per query |
| API key | none needed | `SEARCH_API_KEY` required |
| Key that can leak | none | one more secret to hold |
| Where it runs | your host | third party sees every query |

Two further reasons for SearXNG specifically:

1. **The codebase already chose it.** `builtins.mjs` defaults
   `SEARCH_BACKEND` to `searxng` "per the in-house-first rule". Serper is
   documented there as the fallback.
2. **`SEARCH_API_KEY` is the key that leaked** (`gotchas#499`) and is still
   pending rotation. Choosing SearXNG means that rotation stops being a
   prerequisite for shipping search at all — it stays a separate cleanup.

**Customer privacy matters here.** With Serper, every question a paying
customer asks Mira is sent to a third-party search vendor. With SearXNG on
your own host, it is not.

---

## THE GOTCHA THAT WILL COST YOU AN HOUR IF YOU MISS IT

**SearXNG ships with JSON output DISABLED.** Out of the box it serves HTML
only, and `GET /search?q=...&format=json` returns **HTTP 403**.

`builtins.mjs` calls exactly that URL:

```js
const u = `${base}/search?q=${encodeURIComponent(query)}&format=json`;
```

A 403 is caught and reported as `SEARCH_UNAVAILABLE` — so a SearXNG that looks
perfectly healthy in a browser will still leave Mira saying she cannot search.
`search.formats` **must** include `json`. Step 2 below does that.

---

## Step 0 — preflight (read-only, changes nothing)

```bash
ssh root@23.88.59.31 '
  echo "docker    : $(command -v docker || echo MISSING)"
  echo "compose   : $(docker compose version 2>/dev/null | head -1 || echo MISSING)"
  echo "port 8888 : $(ss -ltn 2>/dev/null | grep -c ":8888 ") in use"
  echo "engine env file:"; ls -l /etc/systemd/system/mira-whatsapp.service.d/ 2>/dev/null
'
```

If `docker` is MISSING, stop and tell me — there is a package-install variant
of this runbook and it is a different procedure.

---

## Step 1 — create the instance directory and a secret

```bash
ssh root@23.88.59.31 '
  set -e
  mkdir -p /opt/searxng
  cd /opt/searxng
  test -f .secret || openssl rand -hex 32 > .secret
  chmod 600 .secret
  echo "secret ready: $(wc -c < .secret) bytes"
'
```

The secret is SearXNG's own session key. It is generated on the host and never
leaves it — do not paste it into a chat, including to me.

---

## Step 2 — settings.yml, with JSON enabled

```bash
ssh root@23.88.59.31 '
  set -e
  cd /opt/searxng
  SECRET=$(cat .secret)
  cat > settings.yml <<YAML
use_default_settings: true
server:
  secret_key: "$SECRET"
  bind_address: "0.0.0.0"
  port: 8080
  limiter: false
search:
  # JSON is what the engine calls. Without this line every lookup 403s and
  # Mira reports SEARCH_UNAVAILABLE while the web UI looks perfectly fine.
  formats:
    - html
    - json
YAML
  chmod 600 settings.yml
  grep -A3 "formats:" settings.yml
'
```

`limiter: false` is correct **only because** the port is bound to loopback in
step 3. It must never be false on a publicly reachable instance.

---

## Step 3 — run it, bound to loopback only

```bash
ssh root@23.88.59.31 '
  set -e
  docker rm -f searxng 2>/dev/null || true
  docker run -d --name searxng --restart unless-stopped \
    -p 127.0.0.1:8888:8080 \
    -v /opt/searxng/settings.yml:/etc/searxng/settings.yml:ro \
    docker.io/searxng/searxng:latest
  sleep 5
  docker ps --filter name=searxng --format "{{.Status}}"
'
```

`127.0.0.1:8888` is deliberate. The engine reaches it over loopback; the
internet cannot reach it at all. Do **not** publish this port.

---

## Step 4 — prove JSON works BEFORE touching the engine

```bash
ssh root@23.88.59.31 '
  curl -s -o /dev/null -w "html: %{http_code}\n" "http://127.0.0.1:8888/search?q=test"
  curl -s -o /dev/null -w "json: %{http_code}\n" "http://127.0.0.1:8888/search?q=test&format=json"
  curl -s "http://127.0.0.1:8888/search?q=hetzner&format=json" | head -c 300
'
```

**Accept only `json: 200` with a JSON body containing a `results` array.**
`json: 403` means step 2 did not take — fix that before going further, because
every later symptom will look like an engine bug instead.

---

## Step 5 — point the engine at it

```bash
ssh root@23.88.59.31 '
  set -e
  D=/etc/systemd/system/mira-whatsapp.service.d
  mkdir -p $D
  cat > $D/20-websearch.conf <<CONF
[Service]
Environment=SEARCH_BACKEND=searxng
Environment=SEARXNG_URL=http://127.0.0.1:8888
Environment=SEARCH_MAX_RESULTS=5
Environment=SEARCH_TIMEOUT_MS=8000
CONF
  systemctl daemon-reload
  systemctl restart mira-whatsapp
  sleep 4
  systemctl is-active mira-whatsapp
  systemctl show mira-whatsapp -p NRestarts
'
```

A separate drop-in file is used so this is one `rm` to undo.

**Never run `systemctl cat` on a Mira unit** — it renders inline `Environment=`
lines and that is how `SEARCH_API_KEY` leaked (`gotchas#499`). `systemctl show
-p NRestarts` is safe; it prints one number.

---

## Step 6 — verify inside the running engine, not by reading config

```bash
ssh root@23.88.59.31 '
  cd /opt/mira/apps/engine
  node -e "
    import(\"./src/builtins.mjs\").then(async m => {
      const cfg = m.searchConfig(process.env);
      console.log(\"backend:\", cfg.backend, \"base:\", cfg.base || \"(none)\");
      const r = await m.runWebSearch({ query: \"hetzner cloud status\" });
      console.log(\"status :\", r.status);
      console.log(\"results:\", r.results.length);
      console.log(\"first  :\", r.results[0] ? r.results[0].url : \"(none)\");
      if (r.status !== \"ok\") console.log(\"reason :\", r.reason);
    });
  "
'
```

**Accept only `status: ok` with `results >= 1` and a real URL.** `status:
unavailable` with `reason: search backend is not configured` means step 5's
environment is not reaching the process.

Note this runs `node -e` under the engine's *shell*, which does not inherit the
systemd drop-in. To test what the **service** actually sees, ask Mira a
question needing current information from your own phone and confirm she cites
sources instead of saying she cannot look things up.

---

## Rollback — one command

```bash
ssh root@23.88.59.31 '
  rm -f /etc/systemd/system/mira-whatsapp.service.d/20-websearch.conf
  systemctl daemon-reload && systemctl restart mira-whatsapp
  docker rm -f searxng
  systemctl is-active mira-whatsapp
'
```

The engine returns to reporting search unavailable, which is honest behaviour
and not an outage.

---

## After it is green

Tell me and I will write the `verifications` row and supersede `state#180` —
with the measured output, not with "the runbook was followed".

## What this does NOT do

- It does not rotate `SEARCH_API_KEY`. That remains open (`gotchas#499`) and is
  yours. Choosing SearXNG means it is no longer blocking anything.
- It does not translate the crisis reply or its hotline numbers. Those stay
  English on purpose — a wrong emergency number could get someone killed, and
  that is owner work by design, recorded in `state#180` item (E).
