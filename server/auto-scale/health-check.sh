#!/usr/bin/env bash
# ============================================================================
# Mira VPN — Health check + auto-scale trigger
# ============================================================================
# Run every 5 min via cron or systemd timer:
#   */5 * * * * /opt/mira-vpn/auto-scale/health-check.sh >> /var/log/mira-scale.log
#
# Thresholds:
#   PEERS_PER_NODE = 150  → provision new node when any node hits this
#   MIN_NODES = 1         → never scale below this
#   MAX_NODES = 10        → hard cap (10 nodes × 1 Gbps = 10 Gbps aggregate)
# ============================================================================

set -euo pipefail

PEERS_PER_NODE=150
MIN_NODES=1
MAX_NODES=10

# Source peers database via API
MASTER_IP="178.104.251.30"

log() { echo "[$(date -Iseconds)] $*"; }

# ---- get node list ----
NODES=$(curl -sf "http://$MASTER_IP/v1/nodes" 2>/dev/null || echo "[]")
NODE_COUNT=$(echo "$NODES" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "$MIN_NODES")

log "Current nodes: $NODE_COUNT"

# ---- check if we need to scale up ----
NEEDS_SCALE=0
while IFS= read -r node; do
    [ -z "$node" ] && continue
    IP=$(echo "$node" | python3 -c "import json,sys; d=json.loads(sys.stdin.readline()); print(d.get('ip',''))" 2>/dev/null)
    PEERS=$(echo "$node" | python3 -c "import json,sys; d=json.loads(sys.stdin.readline()); print(int(d.get('peers',0)))" 2>/dev/null)
    [ -z "$IP" ] && continue
    log "  node $IP: $PEERS peers"

    if [ "$PEERS" -ge "$PEERS_PER_NODE" ]; then
        log "  → OVER threshold ($PEERS_PER_NODE)"
        NEEDS_SCALE=1
    fi
done < <(echo "$NODES" | python3 -c "
import json,sys
nodes=json.load(sys.stdin)
for n in nodes: print(json.dumps(n))
")

# ---- scale up ----
if [ "$NEEDS_SCALE" = "1" ] && [ "$NODE_COUNT" -lt "$MAX_NODES" ]; then
    log "PROVISIONING NEW NODE..."
    /opt/mira-vpn/auto-scale/provision-node.sh
    log "Scale-up complete."
elif [ "$NEEDS_SCALE" = "1" ]; then
    log "MAX NODES ($MAX_NODES) reached — cannot scale further."
fi

# ---- scale down (if all peers on a node == 0 for 6+ hours) ----
# (future: track last_peered_at per node, remove nodes idle > 6h)

log "Health check complete. Nodes: $NODE_COUNT"
