#!/usr/bin/env python3
"""Mira VPN tunnel config issuer. Runs on Hetzner alongside wg0.
Issues a WireGuard peer config on /v1/tunnel/issue. Returns config as text.
"""
import subprocess, time, secrets, os
from pathlib import Path
from flask import Flask, request, jsonify

app = Flask(__name__)
WG_SERVER_PUBKEY = open("/etc/wireguard/server_public.key").read().strip()
SERVER_IP = "178.104.251.30"
SERVER_PORT = 51820
NEXT_IP = [10, 66, 66, 2]  # start allocating from 10.66.66.2

def add_peer(client_pub: str) -> tuple[str, str]:
    """Add a WireGuard peer, return (allocated_ip, config_text)."""
    global NEXT_IP
    ip = ".".join(str(b) for b in NEXT_IP)
    NEXT_IP[3] += 1
    if NEXT_IP[3] > 254:
        NEXT_IP[2] += 1
        NEXT_IP[3] = 2
    subprocess.run([
        "wg", "set", "wg0",
        "peer", client_pub,
        "allowed-ips", f"{ip}/32"
    ], check=True)
    conf = (
        f"[Interface]\n"
        f"PrivateKey = YOUR_CLIENT_PRIVATE_KEY\n"
        f"Address = {ip}/32\n"
        f"DNS = 1.1.1.1, 1.0.0.1\n"
        f"MTU = 1420\n"
        f"\n"
        f"[Peer]\n"
        f"PublicKey = {WG_SERVER_PUBKEY}\n"
        f"Endpoint = {SERVER_IP}:{SERVER_PORT}\n"
        f"AllowedIPs = 0.0.0.0/0, ::/0\n"
        f"PersistentKeepalive = 25\n"
    )
    return ip, conf

@app.route("/tunnel/issue", methods=["POST"])
def issue():
    data = request.get_json(force=True, silent=True) or {}
    tier = data.get("tier", "free")
    client_pub = data.get("public_key", "")
    if not client_pub or not client_pub.strip():
        return jsonify(error="public_key required"), 400
    client_pub = client_pub.strip()
    try:
        ip, conf = add_peer(client_pub)
        # Replace placeholder with caller's actual public key
        conf = conf.replace("YOUR_CLIENT_PRIVATE_KEY", "FILL_ME")
        return jsonify(ip=ip, config=conf, server_endpoint=f"{SERVER_IP}:{SERVER_PORT}", server_public_key=WG_SERVER_PUBKEY)
    except Exception as e:
        return jsonify(error=str(e)), 500

@app.route("/tunnel/remove", methods=["POST"])
def remove():
    data = request.get_json(force=True, silent=True) or {}
    client_pub = data.get("public_key", "")
    if not client_pub or not client_pub.strip():
        return jsonify(error="public_key required"), 400
    subprocess.run(["wg", "set", "wg0", "peer", client_pub.strip(), "remove"], check=True)
    return jsonify(ok=True)

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5103)
