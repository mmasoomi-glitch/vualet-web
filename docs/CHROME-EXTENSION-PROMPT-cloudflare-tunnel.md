# READY-TO-PASTE PROMPT — Claude Chrome extension, Cloudflare dashboard
## Goal: create the tunnel that fixes WhatsApp pairing for every future customer

**Owner: open https://one.dash.cloudflare.com in Chrome, make sure you are logged into the
Cloudflare account that owns the `vualet.com` zone, then paste everything below the line into
the Claude extension on that tab.**

---

You are operating the Cloudflare dashboard for the owner. Work slowly, one step at a time,
and tell the owner what you see before each click. The goal: create a **Cloudflare Tunnel**
named `mira-pairing` that publishes the hostname `api.mira.vualet.com` to the service
`http://127.0.0.1:8790`, and hand the owner the **tunnel token** at the end.

Context you need: `api.mira.vualet.com` currently has a DNS **A record pointing to
89.167.49.209** (a web server where an unrelated product accidentally answers this hostname).
That record must end up **replaced** by the tunnel's CNAME. Touch **nothing else** in the zone
— no other records, no other hostnames, no settings.

### Steps

1. In the left sidebar go to **Networks → Tunnels** (on some accounts: Zero Trust → Networks
   → Tunnels). Click **Create a tunnel**.
2. Choose connector type **Cloudflared**. Name the tunnel exactly: `mira-pairing`. Save.
3. On the connector page, Cloudflare shows install commands containing a long token
   (`eyJ…`). **Copy the ENTIRE token string** — it is the one deliverable of this session.
   Show it to the owner and tell him: *paste this token only into your Claude Code terminal
   session, nowhere else — it is a credential.*
4. Click **Next / Route tunnel**, and add a **Public Hostname**:
   - Subdomain: `api.mira` — Domain: `vualet.com`
   - Path: leave empty
   - Service Type: **HTTP** — URL: `127.0.0.1:8790`
   Save.
5. If Cloudflare refuses because **an A record already exists** for `api.mira`: open
   **vualet.com → DNS → Records** in a new tab, find the single record
   `api.mira` → `89.167.49.209`, **delete only that one record**, return to the tunnel tab
   and save the public hostname again. It will create the CNAME to the tunnel.
   ⚠ Do not delete or edit ANY other record. If you are not certain you are looking at
   exactly `api.mira` → `89.167.49.209`, stop and ask the owner.
6. Finish the wizard. The tunnel will show **Inactive / Down** — that is CORRECT and
   expected: the connector isn't installed yet. The owner's other assistant installs it on
   the server using the token.
7. Confirm to the owner, in one line each: tunnel name, the public hostname mapping, that the
   old A record is gone, and that the token has been copied.

**Do not** create Access policies, WARP settings, or additional hostnames. **Do not** paste
the token into any web form, chat, or note — terminal only.

---

## Owner, after the extension finishes
Paste the token into this Claude Code session as a message like:

```
tunnel token: eyJ....
```

I will then: install `cloudflared` on the engine, bind it to the tunnel, verify
`https://api.mira.vualet.com/pair/...` serves the real pairing page from the outside, run one
customer-shaped pairing probe, and record RUNTIME VERIFIED. The web server can never break
pairing again after this.

*Expected brief impact: none — `/pair` on this hostname is already broken (it serves the
wrong site today), so replacing the record only ever improves it.*
