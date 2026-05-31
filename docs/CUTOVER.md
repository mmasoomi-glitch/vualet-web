# Vualet — Cutover Playbook (Bluehost → Hetzner via Cloudflare)

Zero-downtime sequence. WordPress stays alive on Bluehost the entire time; we only flip DNS once Hetzner is verified green.

## T-0 — Prep (parallel to ongoing dev)

- Hetzner box `afaq-commerce-01` (`89.167.49.209`) confirmed healthy. ✓
- `vualet.com` currently resolves to `66.235.200.145` (Bluehost). Nameservers: `ns1.bluehost.com` / `ns2.bluehost.com`. ✓
- GitHub repo `mmasoomi-glitch/vualet-web` created and built locally. ✓

## T+1 — Cloudflare onboarding (user → 10 min)

User completes steps 1 and 2 in `USER_TODO.md`:
1. Create Cloudflare account, add `vualet.com`.
2. Switch Bluehost nameservers to Cloudflare's.

Result: Cloudflare is now authoritative DNS. WordPress still serves traffic from `66.235.200.145` because Cloudflare imported the existing A record.

**Verify:** `nslookup -type=NS vualet.com` returns `*.ns.cloudflare.com`.

## T+2 — Hetzner box prep (Claude → 15 min)

```bash
ssh root@89.167.49.209
apt-get update && apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | tee /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
mkdir -p /opt/vualet-web
useradd -r -m -s /bin/bash deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh
# add DEPLOY_SSH_KEY public part to /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh /opt/vualet-web
```

Verify: `docker --version` returns 27+, `docker compose version` returns v2.

## T+3 — First deploy (Claude → 10 min)

1. Add GitHub Actions secrets:
   - `DEPLOY_HOST = 89.167.49.209`
   - `DEPLOY_USER = deploy`
   - `DEPLOY_SSH_KEY = <private key>`
   - `GHCR_USER = mmasoomi-glitch`
   - `GHCR_TOKEN = <PAT with read:packages>`
2. Push a commit to `main`.
3. GitHub Actions builds the image, pushes to `ghcr.io/mmasoomi-glitch/vualet-web:latest`, SCPs the compose files, SSHes in, `docker compose pull && up`.
4. Caddy fetches a Let's Encrypt cert for `vualet.com` and `www.vualet.com` — **this only works once DNS resolves to Hetzner**, so first deploy will sit on stale certs. Expected.
5. **Smoke test via IP:** `curl -H "Host: vualet.com" http://89.167.49.209` returns the new site HTML.

## T+4 — DNS flip (Claude → 2 min)

In Cloudflare DNS, edit the existing records:

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `@` | `89.167.49.209` | ✓ Proxied |
| A | `www` | `89.167.49.209` | ✓ Proxied |
| AAAA | `@` | `2a01:4f9:c012:1a43::1` | ✓ Proxied |

Cloudflare propagates instantly. Within 60 s, `vualet.com` resolves to Hetzner (through CF's proxy).

**Verify:**
- `curl -I https://vualet.com` — `server: cloudflare`, `cf-cache-status` present, content is the new Next.js site.
- Browser test: clear cache, hit `vualet.com`, every page loads, no mixed-content warnings, no certificate errors.
- Lighthouse score: target ≥ 95 across the board.

## T+5 — Bake (24 h)

Leave Bluehost WordPress running. Don't touch it.

Monitor:
- Cloudflare Analytics → traffic, error rate, cache hit ratio.
- PostHog / Plausible → sign-up funnel.
- Hetzner metrics → CPU, RAM, network.

If anything breaks: **CF DNS edit, change A records back to `66.235.200.145`.** Instant rollback.

## T+6 — Decommission Bluehost (after 7 days clean)

1. Export anything worth keeping from WordPress (probably nothing — research will confirm).
2. Cancel the Bluehost hosting plan. **Do not let the domain registration lapse if Bluehost is also the registrar** — transfer it to Cloudflare Registrar (at cost) or leave it at Bluehost (just stop paying for hosting).
3. Remove `66.235.200.145` from any monitoring.

Done.
