# Mira VPN — Server Specification v1.0

## 0. What Mira VPN Is (brand context)

Mira isn't a standard VPN company. She is an **AI-assisted personal VPN**
designed around four principles:

1. **She measures.** On every connect, Mira pings the nearest Mira servers
   and picks the one with the fastest measured RTT. No country picker, no
   dropdown, no guesswork.
2. **She picks.** The winning server is the one that actually delivers the
   lowest latency on your current network (Wi-Fi vs cellular vs hotel
   Wi-Fi — all different). This is what we mean by "AI-assisted server
   selection."
3. **She keeps you private.** Your traffic is encrypted between your device
   and the Mira server. We log only what is needed for billing (connection
   counts, bytes used). We do not log DNS, URLs, traffic content.
4. **She pauses for you.** Toggle a single button when your banking app
   refuses to open over VPN. Mira auto-resumes after 30 minutes. Per-app
   "Direct" list keeps your bank, government portal, and any app you choose
   outside the tunnel permanently.

Mira VPN is one product in the **Vualet** family of AI tools (alongside
the Mira personal assistant, Veridian telephony, aFAQ OS enterprise
suite, and Primaion research platform). Vualet is operated out of Dubai
by Dr. Abdolmadjid Masoomi.

The public face is `vpn.mira.vualet.com` (DNS pending; currently live
on Hetzner at `178.104.251.30`).

## 1. Objective of This Specification

This document defines the **server-side infrastructure** needed to run
Mira VPN at production scale — thousands of concurrent users, clear
segmentation between free and paid tiers, automated safeguards against
abuse, and an infrastructure that *feels* fast to every user regardless
of which tier they're on.

It is written for a server engineer or LLM to build against the live
Hetzner node (`178.104.251.30`, project: Mira VPN, isolated from other
Hetzner work). Nothing in this spec requires touching the client apps,
the web frontend, or Uncle Z Calc.

## 2. Current Live State

```
Server       : mira-vpn-01 (Hetzner cx33, 4 cores, 8 GB, 80 GB SSD, 22 TB)
OS           : Ubuntu 24.04, kernel 6.8.0-111
Location     : nbg1 (Nuremberg, DE)
Public IP    : 178.104.251.30
Disk used    : 2.9 / 75 GB (4%)
RAM used     : 665 / 7800 MB (9%)
Load avg     : 0.00 / 0.00 / 0.00

Services     : mira-web (Next.js on :3060)  |  RSS 100 MB
               mira-api (Flask on :5103)    |  RSS  31 MB
               x-ui (3x-ui on :7091)        |  RSS  95 MB
               xray (Reality on :8443)      |  RSS  46 MB
               nginx (reversing /, /v1/, /vpn/) | RSS ~10 MB
               wg-quick (wg0)               |  0 peers connected

WireGuard    : 10.66.66.0/24 subnet
               Server pubkey: ByK5yGC96gYi0GZ/dIoyVBWZkLrCGyQH+XKtxS1UJhE=
               Listen: 178.104.251.30:51820
               MTU: 1420 | Keepalive: 25s | DNS: 1.1.1.1, 1.0.0.1

Firewall     : ufw (22, 80, 443, 8443, 51820/udp open)
IP forward   : enabled (net.ipv4.ip_forward=1)
tc shaper    : NOT APPLIED (clean system, ready for tier-based rules)
```

## 3. Tier-Based Load Control & Traffic Shaping

### 3.1 Tier Matrix

| Parameter | Free | Paid ($9.99/mo) |
|---|---|---|
| Speed per source IP | 500 kbps | 5 Mbps |
| Monthly volume | unlimited (speed-capped) | 50 GB |
| Session length | 2 hours, then drop | unlimited |
| Concurrent IPs per account | 1 | 3 |
| Server selection | nearest only | smart routing |

### 3.2 tc htb Rule Set (Apply via systemd one-shot)

The server has a 1 Gbps NIC. Reserve 200 Mbps for system services,
allocate the rest to VPN traffic with per-tier shaping.

```bash
#!/usr/bin/env bash
# /opt/mira-vpn/tc-tiers.sh — idempotent, run at boot via systemd
set -euo pipefail
IFACE=enp1s0
PORT=51820    # WireGuard port

tc qdisc del dev "$IFACE" root 2>/dev/null || true

# Root: 1000 Mbps total
tc qdisc add dev "$IFACE" root handle 1: htb default 99
tc class add dev "$IFACE" parent 1: classid 1:1 htb rate 1000mbit ceil 1000mbit

# System reserve — 200 Mbps
tc class add dev "$IFACE" parent 1:1 classid 1:99 htb rate 200mbit ceil 1000mbit

# VPN pool — 800 Mbps total for all VPN traffic
tc class add dev "$IFACE" parent 1:1 classid 1:2 htb rate 800mbit ceil 800mbit

# Paid tier — per-IP 5 Mbps (up to ~160 concurrent paid users)
tc class add dev "$IFACE" parent 1:2 classid 1:10 htb rate 5mbit ceil 5mbit quantum 6250

# Free tier — per-IP 500 kbps (up to ~1600 concurrent free users if all 500kbps)
tc class add dev "$IFACE" parent 1:2 classid 1:20 htb rate 500kbit ceil 500kbit quantum 1250

# Default bucket for unrecognised traffic → free tier
tc filter add dev "$IFACE" protocol ip parent 1:0 prio 99 u32 \
    match ip sport "$PORT" 0xffff flowid 1:20

echo "tc tiers applied: paid=5Mbps free=500kbps system=200Mbps"
```

**Note on the limitation of this approach:** tc cannot distinguish "per-IP"
directly via htb — the classes above are per-rule, not per-IP. At launch
this is acceptable because we currently have ~0 connected peers. The correct
long-term solution for per-IP shaping at scale is **TC + iptables MARK**
where the Flask API, on peer registration, runs:

```bash
iptables -t mangle -A POSTROUTING -s <client_wg_ip> -j MARK --set-mark 0x10  # paid
iptables -t mangle -A POSTROUTING -s <client_wg_ip> -j MARK --set-mark 0x20  # free
```

Then tc classifies by mark. This is the production recommendation — the
simple single-class version above handles the first few hundred users.

### 3.3 Per-IP iptables MARK System (Production Scale)

```python
# Inside tunnel-api.py, after successful peer registration:
def apply_mark(client_ip: str, tier: str):
    mark_hex = "0x10" if tier == "paid" else "0x20"
    subprocess.run([
        "iptables", "-t", "mangle", "-A", "POSTROUTING",
        "-s", client_ip, "-j", "MARK", "--set-mark", mark_hex
    ], check=True)

def remove_mark(client_ip: str):
    # Best-effort cleanup — delete any mark rule for this IP
    subprocess.run([
        "iptables", "-t", "mangle", "-D", "POSTROUTING",
        "-s", client_ip, "-j", "MARK"
    ], check=False)
```

Wire the above into the `/tunnel/issue` endpoint (on success, after
`wg set wg0 peer`) and `/tunnel/remove` endpoint.

### 3.4 2-Hour Free Session Cap

A systemd timer runs every 5 minutes. It scans WireGuard peers, finds
free-tier peers whose handshake is older than 7200 seconds, and prunes
them:

```bash
#!/usr/bin/env bash
# /opt/mira-vpn/prune-free-sessions.sh
set -euo pipefail
MAX_AGE=7200  # 2 hours in seconds
NOW=$(date +%s)

wg show wg0 dump | tail -n +2 | while read -r pubkey _ ip _ _ _ handshake _; do
    [ -z "$pubkey" ] && continue
    # Free-tier peers have mark 0x20
    MARKED=$(iptables -t mangle -L POSTROUTING -n 2>/dev/null | grep "$ip" | grep -c '0x20' || true)
    if [ "$MARKED" -gt 0 ] && [ $(( NOW - handshake )) -gt "$MAX_AGE" ]; then
        wg set wg0 peer "$pubkey" remove
        iptables -t mangle -D POSTROUTING -s "$ip" -j MARK 2>/dev/null || true
        echo "$(date -Iseconds) pruned free peer $ip (age=$((NOW - handshake))s)"
    fi
done

# Also flush conntrack for pruned IPs so old flows don't linger
conntrack -D -s 10.66.66.0/24 --state ESTABLISHED 2>/dev/null || true
```

**Systemd timer:**
```ini
# /etc/systemd/system/mira-prune.timer
[Unit]
Description=Prune stale free-tier WireGuard peers every 5 min

[Timer]
OnCalendar=*:0/5
Persistent=true

[Install]
WantedBy=timers.target
```

```ini
# /etc/systemd/system/mira-prune.service
[Unit]
Description=Prune free-tier WireGuard peers

[Service]
Type=oneshot
ExecStart=/opt/mira-vpn/prune-free-sessions.sh
```

### 3.5 Per-Account Volume Cap (50 GB paid)

WireGuard kernel driver does not expose byte counters efficiently to
userspace. We track volume at the kernel level via `iptables -nvx`:

```bash
#!/usr/bin/env bash
# /opt/mira-vpn/check-volume.sh
MAX_BYTES=$(( 50 * 1024 * 1024 * 1024 ))  # 50 GB
iptables -nvx -t mangle -L POSTROUTING | while read -r pkts bytes _ _ _ _ mark _; do
    [ "$mark" = "MARK" ] || continue
    if [ "$bytes" -gt "$MAX_BYTES" ]; then
        echo "OVER_CAP: mark=${pkts} bytes=${bytes}"
    fi
done
```

For the initial deployment, wire the API to track volume per peer key in
a SQLite table (`/opt/mira-api/peers.db`) updated on disconnect. The
prune timer also checks for volume overcap and removes offending peers.

Long-term: WireGuard `wg show wg0 transfer` provides `(received,sent)`
per peer — parse that on every prune cycle and accumulate.

## 4. Nginx Rewrite & Optimization Rules

### 4.1 Gzip + Cache

```nginx
# In /etc/nginx/nginx.conf, inside the http {} block:
gzip on;
gzip_types text/css application/javascript image/svg+xml application/json;
gzip_min_length 1000;

# Static asset caching
location /_next/static/ {
    expires 365d;
    add_header Cache-Control "public, immutable";
}

location /mira/ {
    expires 7d;
    add_header Cache-Control "public";
}
```

### 4.2 Rate Limiting on API

```nginx
# Inside /etc/nginx/nginx.conf, inside http {}:
limit_req_zone $binary_remote_addr zone=mira_api:10m rate=5r/s;

# Inside the /v1/ location block:
location /v1/ {
    limit_req zone=mira_api burst=10 nodelay;
    # ... rest of proxy_pass config
}
```

This allows 5 requests/second per IP with a burst of 10, which handles
legitimate key generation (a few per session) while blocking rapid abuse.

### 4.3 Connection Buffering & Timeouts

```nginx
# Inside /v1/ location:
proxy_buffering on;
proxy_buffer_size 4k;
proxy_buffers 8 16k;
proxy_read_timeout 30s;
proxy_connect_timeout 5s;

# Inside / location:
proxy_read_timeout 60s;
proxy_connect_timeout 10s;
```

## 5. DNS Acceleration

The WireGuard config currently points clients to `1.1.1.1`. At scale,
add a local caching resolver to avoid adding 40–80 ms of DNS round-trip
to every connection:

```bash
apt-get install -y unbound

cat > /etc/unbound/unbound.conf.d/mira.conf << 'EOF'
server:
    interface: 127.0.0.1
    port: 5353
    access-control: 127.0.0.0/8 allow
    access-control: 10.66.66.0/24 allow
    prefetch: yes
    prefetch-key: yes
    cache-min-ttl: 3600
    serve-expired: yes
    rrset-roundrobin: yes
    qname-minimisation: yes
    hide-identity: yes
    hide-version: yes
forward-zone:
    name: "."
    forward-addr: 1.1.1.1
    forward-addr: 1.0.0.1
EOF

systemctl enable --now unbound
```

Then update the WireGuard tunnel config returned by the API to use
`DNS = 10.66.66.1` instead of `1.1.1.1`. 5353 UDP → the WireGuard
subnet gateway.

## 6. Kernel Tuning (Speed Perception)

```bash
# /etc/sysctl.d/90-mira-vpn.conf
# Apply: sysctl --system

# BBR congestion control — better throughput on lossy links
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# Buffer sizing — handle bursts without tail-dropping
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216

# WireGuard doesn't fragment — helps with path MTU discovery
net.ipv4.ip_no_pmtu_disc = 0

# Reduce TCP keepalive from 2h to 60s (mobile networks drop stale connections)
net.ipv4.tcp_keepalive_time = 60
net.ipv4.tcp_keepalive_intvl = 10
net.ipv4.tcp_keepalive_probes = 6

# Faster reuse of TIME_WAIT sockets — reduces port exhaustion
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15

# Enable TCP Fast Open — saves one round-trip on repeat connections
net.ipv4.tcp_fastopen = 3

# Increase max open files for the WireGuard and nginx processes
fs.file-max = 2097152
```

## 7. Process Supervision & Health Checks

All services that can fail silently must be supervised:

```ini
# /etc/systemd/system/mira-watchdog.service
[Unit]
Description=Mira VPN — service health watchdog
After=network.target

[Service]
Type=simple
ExecStart=/opt/mira-vpn/watchdog.py
Restart=always
RestartSec=30
StandardOutput=append:/opt/mira-vpn/logs/watchdog.log
StandardError=append:/opt/mira-vpn/logs/watchdog.log

[Install]
WantedBy=multi-user.target
```

```python
#!/usr/bin/env python3
# /opt/mira-vpn/watchdog.py — health check loop
import subprocess, time, sys, socket

SERVICES = ["mira-web", "mira-api", "nginx", "x-ui"]
PORT_CHECKS = {51820: "WireGuard", 3060: "Next.js", 5103: "Flask API", 80: "nginx"}

def check_service(name):
    try:
        subprocess.run(["systemctl", "is-active", name], check=True, timeout=5)
        return True
    except Exception:
        return False

def check_port(port):
    try:
        s = socket.create_connection(("127.0.0.1", port), timeout=3)
        s.close()
        return True
    except Exception:
        return False

while True:
    for svc in SERVICES:
        if not check_service(svc):
            print(f"RESTART {svc}")
            subprocess.run(["systemctl", "restart", svc], timeout=10)
    for port, name in PORT_CHECKS.items():
        if not check_port(port):
            print(f"PORT DOWN {name}:{port}")
    time.sleep(60)
```

## 8. Abuse & Multi-Tenant Safeguards

### 8.1 Connection Limits per Peer

```bash
# Limit each WireGuard peer to 50 concurrent connections
iptables -I FORWARD -i wg0 -p tcp -m connlimit --connlimit-above 50 --connlimit-mask 32 \
    -j REJECT --reject-with tcp-reset
iptables -I FORWARD -i wg0 -p udp -m connlimit --connlimit-above 200 --connlimit-mask 32 \
    -j DROP
```

### 8.2 Peer Registration Rate Cap (Python, in tunnel-api.py)

```python
import time
from collections import defaultdict

_registry = defaultdict(list)  # ip → [timestamps]

MAX_PEERS_PER_IP = 5
PEER_WINDOW_SECONDS = 3600

def rate_check(client_real_ip: str) -> bool:
    now = time.time()
    _registry[client_real_ip] = [t for t in _registry[client_real_ip] if now - t < PEER_WINDOW_SECONDS]
    if len(_registry[client_real_ip]) >= MAX_PEERS_PER_IP:
        return False
    _registry[client_real_ip].append(now)
    return True
```

Wire `rate_check(request.remote_addr)` into the `/tunnel/issue` endpoint.
If false, return 429 (Too Many Requests) with `{"error":"rate_limited"}`.

### 8.3 Block P2P / Torrent on Free Tier

Add an iptables rule that blocks common BitTorrent ports on the free
tier mark (0x20):

```bash
iptables -A FORWARD -i wg0 -m mark --mark 0x20 -p tcp \
    -m multiport --dports 6881:6889,6969,1337,51413 \
    -j REJECT --reject-with tcp-reset
```

### 8.4 Prevent IP Spoofing from WG Subnet

```bash
# Only allow traffic that originated from our assigned subnet
iptables -A FORWARD -i wg0 -s 10.66.66.0/24 -j ACCEPT
iptables -A FORWARD -i wg0 -j DROP
```

## 9. WireGuard Peer Database (tunnel-api.py extension)

Add SQLite tracking for every issued peer:

```python
# In tunnel-api.py, after the wireguard wg set call:
import sqlite3

def init_db():
    with sqlite3.connect('/opt/mira-api/peers.db') as c:
        c.execute("""CREATE TABLE IF NOT EXISTS peers(
            pubkey TEXT PRIMARY KEY,
            ip TEXT NOT NULL,
            tier TEXT NOT NULL DEFAULT 'free',
            registered_at TEXT NOT NULL,
            last_handshake TEXT,
            tx_bytes INTEGER DEFAULT 0,
            rx_bytes INTEGER DEFAULT 0,
            alive INTEGER DEFAULT 1
        )""")

def register_peer(pubkey, ip, tier):
    with sqlite3.connect('/opt/mira-api/peers.db') as c:
        c.execute(
            "INSERT INTO peers(pubkey, ip, tier, registered_at) VALUES(?,?,?,datetime('now'))",
            (pubkey, ip, tier)
        )
```

Then `get_known_peers()` returns all live peers and the watchdog or prune
timer can query `peers.db` to find stale entries.

## 10. Rewrite Summary — What Gets Better After This Spec

| Before | After |
|---|---|
| No traffic shaping — one user can saturate 143 Mbps | tc per-tier: free 500k, paid 5M, system 200M reserve |
| No peer database — can't tell who's connected | SQLite `peers.db` tracking every issued peer |
| No session limit — free users stay forever | 2-hour prune timer for free-tier peers |
| No volume cap enforcement | iptables byte counter + 50 GB check |
| No API rate limiting — brute-forcable | nginx `limit_req` 5 r/s per IP |
| No per-IP connection caps | iptables connlimit 50 TCP / 200 UDP per peer |
| No DNS cache — every query hits 1.1.1.1 | local unbound resolver, 0-2 ms DNS |
| No congestion control tuning | BBR + fq + buffer tuning = faster felt speed |
| No process watchdog | systemd timer auto-restarts dead services |
| WireGuard peer list visible to any connected peer | iptables restricts forwarding to our subnet only |
| P2P/torrent on free tier unrestricted | iptables blocks common torrent ports on free mark |

## 11. Implementation Order (build this in sequence, not all at once)

1. **Kernel tuning** (BBR, buffer sizes, TCP fast open) — 5 min, highest impact
2. **tc tier shaping** (one script, systemd one-shot at boot) — 10 min
3. **nginx rate limiting + gzip + caching** — 10 min
4. **Peer database + wire into tunnel-api.py** — 15 min
5. **2-hour free session prune timer** — 10 min
6. **iptables mark system (per-IP shaping)** — 15 min
7. **unbound DNS resolver** — 5 min
8. **Watchdog service** — 10 min
9. **Connlimit + torrent blocking + subnet filtering** — 5 min
10. **Volume cap check in prune timer** — 10 min

Total: under 2 hours for the full stack.
