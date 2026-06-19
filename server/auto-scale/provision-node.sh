#!/usr/bin/env bash
# ============================================================================
# Mira VPN — Hetzner auto-scale node provisioner
# ============================================================================
# Called by health-check.sh when currentWireGuardPeers >= 150 per node.
# Creates a new CX23 (€8.49/mo, 22 TB egress) in the configured datacenter,
# installs WireGuard + the tunnel API, and returns its public IP + pubkey.
#
# Requires: HCLOUD_TOKEN env var (Hetzner Cloud API Read & Write token)
#           HCLOUD_SSH_KEY_ID (SSH key fingerprint registered in Hetzner project)
#
# Usage: ./provision-node.sh [datacenter] [server-type]
#   datacenter defaults to nbg1 (Nuremberg)
#   server-type defaults to cx23 (2 vCPU, 4 GB, 40 GB, 22 TB)
# ============================================================================

set -euo pipefail

HCLOUD_API="https://api.hetzner.cloud/v1"
DATACENTER="${1:-nbg1}"
SERVER_TYPE="${2:-cx23}"
SERVER_NAME="mira-vpn-node-$(date +%Y%m%d-%H%M%S)"
SSH_KEY_ID="${HCLOUD_SSH_KEY_ID:?HCLOUD_SSH_KEY_ID not set}"
TOKEN="${HCLOUD_TOKEN:?HCLOUD_TOKEN not set}"

log() { echo "[$(date -Iseconds)] $*"; }

# ---- cloud-init script ----
# This runs on the new server within 60 seconds of provisioning.
# Installs WireGuard, the tunnel API, and registers with the master.

read -r -d '' CLOUD_INIT << 'CLOUDEOF' || true
#cloud-config
package_update: true
package_upgrade: true
packages:
  - wireguard
  - wireguard-tools
  - nginx
  - python3-pip
  - python3-venv
  - ufw
  - htop
runcmd:
  - |
    # Generate WireGuard keypair
    mkdir -p /etc/wireguard
    wg genkey > /etc/wireguard/private.key
    wg pubkey < /etc/wireguard/private.key > /etc/wireguard/public.key
    PUBKEY=$(cat /etc/wireguard/public.key)
    PRIVKEY=$(cat /etc/wireguard/private.key)

    # Register with master API
    MASTER_IP="178.104.251.30"
    curl -s -X POST "http://$MASTER_IP/v1/register-node" \
      -H "Content-Type: application/json" \
      -d "{\"public_key\":\"$PUBKEY\",\"private_key\":\"$PRIVKEY\",\"hostname\":\"$(hostname)\"}" \
      > /var/log/mira-register.log 2>&1

    # Firewall
    ufw default deny incoming
    ufw allow 22/tcp
    ufw allow 51820/udp
    ufw allow 80/tcp
    ufw --force enable

    echo "Mira node bootstrapped. Pubkey: $PUBKEY"
CLOUDEOF

# ---- create server ----
log "Provisioning $SERVER_NAME ($SERVER_TYPE in $DATACENTER)..."

RESPONSE=$(curl -sS -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "$HCLOUD_API/servers" \
  -d "$(cat << JSON
{
  "name": "$SERVER_NAME",
  "server_type": "$SERVER_TYPE",
  "datacenter": "$DATACENTER",
  "image": "ubuntu-24.04",
  "ssh_keys": [$SSH_KEY_ID],
  "user_data": "$(echo "$CLOUD_INIT" | base64 -w0)",
  "labels": {
    "role": "vpn-node",
    "product": "mira",
    "managed-by": "auto-scale"
  },
  "start_after_create": true
}
JSON
)")

SERVER_ID=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['server']['id'])" 2>/dev/null)
PUBLIC_IP=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['server']['public_net']['ipv4']['ip'])" 2>/dev/null)

if [ -z "$SERVER_ID" ] || [ -z "$PUBLIC_IP" ]; then
    log "ERROR: Failed to provision. Response: $RESPONSE"
    exit 1
fi

log "Server $SERVER_ID created. IP: $PUBLIC_IP"

# ---- wait for cloud-init ----
log "Waiting for cloud-init to finish..."
for i in $(seq 1 60); do
    STATUS=$(curl -sS -H "Authorization: Bearer $TOKEN" \
        "$HCLOUD_API/servers/$SERVER_ID" | \
        python3 -c "import json,sys; print(json.load(sys.stdin)['server']['status'])")
    [ "$STATUS" = "running" ] && break
    sleep 5
done

# ---- fetch the new node's WireGuard pubkey ----
WG_PUBKEY=$(ssh -o StrictHostKeyChecking=accept-new \
    "root@$PUBLIC_IP" "cat /etc/wireguard/public.key" 2>/dev/null || echo "unknown")

# ---- output for the master's peer database ----
cat << OUTPUT
NODE_PROVISIONED
  id:         $SERVER_ID
  name:       $SERVER_NAME
  ip:         $PUBLIC_IP
  wg_pubkey:  $WG_PUBKEY
  datacenter: $DATACENTER
OUTPUT
