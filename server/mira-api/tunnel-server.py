#!/usr/bin/env python3
"""
Mira VPN — Tunnel API (production).
======================================
- WireGuard peer registration + config issuance
- Per-IP rate limiting (5 peers per hour per real IP)
- Tier-based iptables marking (free=0x20, paid=0x10)
- Node registration for auto-scale
- SQLite peer database for tracking, stats, pruning

Deploy: systemctl restart mira-api
Listens: 127.0.0.1:5103 (behind nginx /v1/)
"""
import json
import os
import re
import sqlite3
import subprocess
import time
from collections import defaultdict
from pathlib import Path

from flask import Flask, request, jsonify

app = Flask(__name__)

# ---- config ----
DB = Path("/opt/mira-api/peers.db")
WG_IFACE = "wg0"
SUBNET_NEXT = [10, 66, 66, 2]  # next available IP in 10.66.66.0/24
MAX_PEERS_PER_IP = 5
RATE_WINDOW = 3600  # 1 hour
REGISTRY = defaultdict(list)  # real_ip → [timestamps]

# ---- init ----
def init_db():
    with sqlite3.connect(DB) as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS peers (
            pubkey    TEXT PRIMARY KEY,
            ip        TEXT NOT NULL,
            tier      TEXT DEFAULT 'free',
            real_ip   TEXT,
            registered_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_handshake TEXT,
            tx_bytes  INTEGER DEFAULT 0,
            rx_bytes  INTEGER DEFAULT 0,
            alive     INTEGER DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS nodes (
            id        TEXT PRIMARY KEY,
            ip        TEXT NOT NULL,
            pubkey    TEXT NOT NULL,
            datacenter TEXT,
            active    INTEGER DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS tickets (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            email     TEXT,
            subject   TEXT,
            body      TEXT,
            status    TEXT DEFAULT 'open',
            created_at TEXT DEFAULT (datetime('now')),
            resolved_at TEXT
        );
        """)

init_db()

# ---- helpers ----
def rate_check(real_ip: str) -> bool:
    now = time.time()
    REGISTRY[real_ip] = [t for t in REGISTRY[real_ip] if now - t < RATE_WINDOW]
    if len(REGISTRY[real_ip]) >= MAX_PEERS_PER_IP:
        return False
    REGISTRY[real_ip].append(now)
    return True

def apply_mark(client_ip: str, tier: str):
    mark = "0x10" if tier == "paid" else "0x20"
    subprocess.run([
        "iptables", "-t", "mangle", "-A", "POSTROUTING",
        "-s", client_ip, "-j", "MARK", "--set-mark", mark
    ], check=True, stderr=subprocess.DEVNULL)

def server_pubkey() -> str:
    return Path(f"/etc/wireguard/{WG_IFACE}.public.key").read_text().strip()

def server_privkey() -> str:
    return Path(f"/etc/wireguard/{WG_IFACE}.private.key").read_text().strip()

def server_endpoint() -> str:
    # return primary IP of this machine
    out = subprocess.check_output(
        "ip -4 addr show eth0 | grep -oP 'inet \\K[\\d.]+'", shell=True, text=True
    ).strip()
    return f"{out}:51820"

def build_config(client_pub: str, client_priv: str, client_ip: str):
    pub = server_pubkey()
    ep = server_endpoint()
    return (
        f"[Interface]\n"
        f"PrivateKey = {client_priv}\n"
        f"Address = {client_ip}/32\n"
        f"DNS = 1.1.1.1, 1.0.0.1\n"
        f"MTU = 1420\n\n"
        f"[Peer]\n"
        f"PublicKey = {pub}\n"
        f"Endpoint = {ep}\n"
        f"AllowedIPs = 0.0.0.0/0, ::/0\n"
        f"PersistentKeepalive = 25\n"
    )

# ---- routes ----
@app.route("/tunnel/issue", methods=["POST"])
def tunnel_issue():
    data = request.get_json(force=True, silent=True) or {}
    client_pub = (data.get("public_key") or "").strip()
    tier = data.get("tier", "free").strip()
    real_ip = request.remote_addr or "0.0.0.0"

    # validate pubkey (44-char base64, no padding)
    if not re.match(r'^[A-Za-z0-9+/]{43,44}=?$', client_pub):
        return jsonify(error="invalid public_key"), 400
    if tier not in ("free", "paid"):
        return jsonify(error="invalid tier"), 400
    if not rate_check(real_ip):
        return jsonify(error="rate_limited", retry_after_sec=RATE_WINDOW), 429

    # allocate IP
    global SUBNET_NEXT
    client_ip = ".".join(str(b) for b in SUBNET_NEXT)
    SUBNET_NEXT[3] += 1
    if SUBNET_NEXT[3] > 254:
        SUBNET_NEXT[2] += 1
        SUBNET_NEXT[3] = 2

    # generate client private key + add peer
    try:
        client_priv = subprocess.check_output(["wg", "genkey"], text=True).strip()
        subprocess.run([
            "wg", "set", WG_IFACE,
            "peer", client_pub,
            "allowed-ips", f"{client_ip}/32"
        ], check=True, stderr=subprocess.PIPE)

        if client_priv:
            # persist
            with sqlite3.connect(DB) as c:
                c.execute(
                    "INSERT OR REPLACE INTO peers(pubkey, ip, tier, real_ip) VALUES(?,?,?,?)",
                    (client_pub, client_ip, tier, real_ip)
                )
            apply_mark(client_ip, tier)

            config = build_config(client_pub, client_priv, client_ip)

            return jsonify(
                ip=client_ip,
                server_endpoint=server_endpoint(),
                server_public_key=server_pubkey(),
                config=config,
                tier=tier
            )
    except subprocess.CalledProcessError as e:
        return jsonify(error=f"wireguard error: {e.stderr}"), 500

    return jsonify(error="internal error"), 500


@app.route("/tunnel/remove", methods=["POST"])
def tunnel_remove():
    data = request.get_json(force=True, silent=True) or {}
    pubkey = (data.get("public_key") or "").strip()
    if not pubkey:
        return jsonify(error="public_key required"), 400
    subprocess.run(["wg", "set", WG_IFACE, "peer", pubkey, "remove"],
                   stderr=subprocess.DEVNULL)
    with sqlite3.connect(DB) as c:
        c.execute("UPDATE peers SET alive=0 WHERE pubkey=?", (pubkey,))
    return jsonify(ok=True)


@app.route("/tunnel/issue-direct", methods=["POST"])
def tunnel_issue_direct():
    """For clients that bring their own private key (the typical flow).
    Returns config with 'FILL_ME' placeholder — client substitutes their privkey."""
    data = request.get_json(force=True, silent=True) or {}
    client_pub = (data.get("public_key") or "").strip()
    tier = data.get("tier", "free").strip()
    real_ip = request.remote_addr or "0.0.0.0"

    if not re.match(r'^[A-Za-z0-9+/]{43,44}=?$', client_pub):
        return jsonify(error="invalid public_key"), 400
    if not rate_check(real_ip):
        return jsonify(error="rate_limited"), 429

    global SUBNET_NEXT
    client_ip = ".".join(str(b) for b in SUBNET_NEXT)
    SUBNET_NEXT[3] += 1
    if SUBNET_NEXT[3] > 254:
        SUBNET_NEXT[2] += 1
        SUBNET_NEXT[3] = 2

    try:
        subprocess.run(["wg", "set", WG_IFACE, "peer", client_pub,
                        "allowed-ips", f"{client_ip}/32"], check=True)
        with sqlite3.connect(DB) as c:
            c.execute(
                "INSERT OR REPLACE INTO peers(pubkey, ip, tier, real_ip) VALUES(?,?,?,?)",
                (client_pub, client_ip, tier, real_ip)
            )
        apply_mark(client_ip, tier)

        config = (
            f"[Interface]\n"
            f"PrivateKey = FILL_ME\n"
            f"Address = {client_ip}/32\n"
            f"DNS = 1.1.1.1, 1.0.0.1\n"
            f"MTU = 1420\n\n"
            f"[Peer]\n"
            f"PublicKey = {server_pubkey()}\n"
            f"Endpoint = {server_endpoint()}\n"
            f"AllowedIPs = 0.0.0.0/0, ::/0\n"
            f"PersistentKeepalive = 25\n"
        )
        return jsonify(
            ip=client_ip,
            server_endpoint=server_endpoint(),
            server_public_key=server_pubkey(),
            config=config,
            tier=tier
        )
    except subprocess.CalledProcessError as e:
        return jsonify(error=str(e)), 500


@app.route("/register-node", methods=["POST"])
def register_node():
    """Called by auto-scale new nodes via cloud-init."""
    data = request.get_json(force=True, silent=True) or {}
    pubkey = (data.get("public_key") or "").strip()
    ip = request.remote_addr or "0.0.0.0"

    with sqlite3.connect(DB) as c:
        c.execute(
            "INSERT OR REPLACE INTO nodes(id, ip, pubkey, datacenter, active) "
            "VALUES(?,?,?,?,?)",
            (pubkey[:16], ip, pubkey, "auto", 1)
        )
    return jsonify(ok=True, node_id=pubkey[:16])


@app.route("/nodes", methods=["GET"])
def list_nodes():
    with sqlite3.connect(DB) as c:
        rows = c.execute(
            "SELECT id, ip, pubkey, datacenter, active FROM nodes WHERE active=1"
        ).fetchall()
    nodes = [
        {"id": r[0], "ip": r[1], "pubkey": r[2], "datacenter": r[3],
         "peers": _peer_count_for_node(r[1])}
        for r in rows
    ]
    return jsonify(nodes)


def _peer_count_for_node(ip: str) -> int:
    """Count WireGuard peers on a node via SSH (future) or return local count."""
    try:
        out = subprocess.check_output(["wg", "show", WG_IFACE, "dump"], text=True)
        return max(0, len(out.strip().split("\n")) - 1)
    except Exception:
        return 0


@app.route("/peers", methods=["GET"])
def list_peers():
    with sqlite3.connect(DB) as c:
        rows = c.execute(
            "SELECT pubkey, ip, tier, real_ip, registered_at, tx_bytes, rx_bytes "
            "FROM peers WHERE alive=1 ORDER BY registered_at DESC LIMIT 500"
        ).fetchall()
    return jsonify([{
        "pubkey": r[0], "ip": r[1], "tier": r[2], "real_ip": r[3],
        "registered_at": r[4], "tx_bytes": r[5], "rx_bytes": r[6]
    } for r in rows])


@app.route("/stats", methods=["GET"])
def stats():
    peerc = _peer_count_for_node("local")
    with sqlite3.connect(DB) as c:
        total = c.execute("SELECT COUNT(*) FROM peers WHERE alive=1").fetchone()[0]
        free_c = c.execute("SELECT COUNT(*) FROM peers WHERE alive=1 AND tier='free'").fetchone()[0]
        paid_c = c.execute("SELECT COUNT(*) FROM peers WHERE alive=1 AND tier='paid'").fetchone()[0]
        total_tx = c.execute("SELECT COALESCE(SUM(tx_bytes),0) FROM peers").fetchone()[0]
        total_rx = c.execute("SELECT COALESCE(SUM(rx_bytes),0) FROM peers").fetchone()[0]
        node_c = c.execute("SELECT COUNT(*) FROM nodes WHERE active=1").fetchone()[0]
    return jsonify(
        peers_wg=peerc, peers_db=total,
        free=free_c, paid=paid_c,
        tx_bytes=total_tx, rx_bytes=total_rx,
        active_nodes=node_c
    )


# DeepSeek support ticket creation (called by the web /api/support/chat route)
@app.route("/tickets", methods=["POST"])
def create_ticket():
    data = request.get_json(force=True, silent=True) or {}
    email = (data.get("email") or "anonymous").strip()
    subject = (data.get("subject") or "Support request").strip()
    body = (data.get("body") or "").strip()

    with sqlite3.connect(DB) as c:
        c.execute(
            "INSERT INTO tickets(email, subject, body) VALUES(?,?,?)",
            (email, subject, body)
        )
        tid = c.lastrowid
    return jsonify(ok=True, ticket_id=tid)


@app.route("/tickets", methods=["GET"])
def list_tickets():
    status = request.args.get("status", "open")
    with sqlite3.connect(DB) as c:
        rows = c.execute(
            "SELECT id, email, subject, status, created_at "
            "FROM tickets WHERE status=? ORDER BY created_at DESC LIMIT 100",
            (status,)
        ).fetchall()
    return jsonify([{
        "id": r[0], "email": r[1], "subject": r[2],
        "status": r[3], "created_at": r[4]
    } for r in rows])


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5103)
