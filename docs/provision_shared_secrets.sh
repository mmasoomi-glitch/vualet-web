#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Place the three shared config values that WhatsApp pairing needs.
#
# RUN THIS YOURSELF. An agent is blocked from it by the lockdown policy, which
# forbids reading or writing secret paths. That control was not bypassed.
#
# WHAT IT DOES, and what it deliberately does not do:
#   - It moves two secrets HOST TO HOST over your own SSH connections. The
#     values are never printed, never written to a log, never echoed, and never
#     pass through any agent's context. The only thing this script ever shows
#     you is a 12-character SHA-256 prefix, which proves the two sides match
#     without revealing what they hold.
#   - It is IDEMPOTENT. Running it twice does not append a duplicate line.
#     If a key is already present on the destination it is left alone and
#     reported, never silently overwritten — if you WANT to overwrite, remove
#     the existing line by hand first, deliberately.
#   - It re-asserts file mode and ownership after every write.
#
# Run from Git Bash on your workstation. Both keys must be present locally.
# ---------------------------------------------------------------------------
set -euo pipefail

ENGINE_KEY="$HOME/.ssh/mira_hetzner"
WEB_KEY="$HOME/.ssh/afaq_vps_ed25519"
ENGINE="root@23.88.59.31"
WEB="root@89.167.49.209"

ENGINE_ENV="/etc/mira/mira-whatsapp.env"      # root:root 0600
WEB_ENV="/opt/mira-web/runtime.conf"          # mira-web:mira-web 0600

e_ssh() { ssh -i "$ENGINE_KEY" -o IdentitiesOnly=yes -o ConnectTimeout=20 "$ENGINE" "$@"; }
w_ssh() { ssh -i "$WEB_KEY"    -o IdentitiesOnly=yes -o ConnectTimeout=20 "$WEB"    "$@"; }

say() { printf '\n== %s\n' "$*"; }

# --------------------------------------------------------------------------
say "0. Reachability"
e_ssh 'echo "  engine: $(hostname) ok"'
w_ssh 'echo "  web:    $(hostname) ok"'

# --------------------------------------------------------------------------
say "1. WA_PROVISION_SECRET  (engine -> web)"
# Without this the web app cannot authenticate to the gateway, so every
# customer sees "WhatsApp linking isn't available right now".
if w_ssh "grep -q '^WA_PROVISION_SECRET=' $WEB_ENV"; then
  echo "  already present on the web host — leaving it alone"
else
  e_ssh "grep '^WA_PROVISION_SECRET=' $ENGINE_ENV" \
    | w_ssh "cat >> $WEB_ENV && chown mira-web:mira-web $WEB_ENV && chmod 600 $WEB_ENV"
  echo "  copied"
fi

# --------------------------------------------------------------------------
say "2. MIRA_BIND_SECRET  (web -> engine)"
# Without this the engine cannot call back to claim the connect token, so the
# single-use guarantee never fires and a link could be reused.
if e_ssh "grep -q '^MIRA_BIND_SECRET=' $ENGINE_ENV"; then
  echo "  already present on the engine — leaving it alone"
else
  w_ssh "grep '^MIRA_BIND_SECRET=' $WEB_ENV" \
    | e_ssh "cat >> $ENGINE_ENV && chown root:root $ENGINE_ENV && chmod 600 $ENGINE_ENV"
  echo "  copied"
fi

# --------------------------------------------------------------------------
say "3. MIRA_WEB_URL  (engine) — not a secret"
e_ssh "grep -q '^MIRA_WEB_URL=' $ENGINE_ENV \
        || { printf 'MIRA_WEB_URL=https://mira.vualet.com\n' >> $ENGINE_ENV; }
      chown root:root $ENGINE_ENV; chmod 600 $ENGINE_ENV
      echo \"  present: \$(grep -c '^MIRA_WEB_URL=' $ENGINE_ENV)\""

# --------------------------------------------------------------------------
say "4. Restart both sides"
e_ssh 'systemctl restart mira-whatsapp; sleep 6
       echo "  mira-whatsapp: $(systemctl is-active mira-whatsapp) NRestarts=$(systemctl show mira-whatsapp -p NRestarts --value)"'
w_ssh 'systemctl restart mira-web; sleep 6
       echo "  mira-web: $(systemctl is-active mira-web) NRestarts=$(systemctl show mira-web -p NRestarts --value)"'

# --------------------------------------------------------------------------
say "5. Do the two sides agree? (digests only — never the values)"
EP=$(e_ssh "grep -h '^WA_PROVISION_SECRET=' $ENGINE_ENV | cut -d= -f2- | tr -d '\r\n' | sha256sum | cut -c1-12")
WP=$(w_ssh "grep -h '^WA_PROVISION_SECRET=' $WEB_ENV    | cut -d= -f2- | tr -d '\r\n' | sha256sum | cut -c1-12")
EB=$(e_ssh "grep -h '^MIRA_BIND_SECRET='    $ENGINE_ENV | cut -d= -f2- | tr -d '\r\n' | sha256sum | cut -c1-12")
WB=$(w_ssh "grep -h '^MIRA_BIND_SECRET='    $WEB_ENV    | cut -d= -f2- | tr -d '\r\n' | sha256sum | cut -c1-12")

printf '  WA_PROVISION_SECRET  engine=%s  web=%s  %s\n' "$EP" "$WP" \
  "$([ "$EP" = "$WP" ] && echo MATCH || echo '*** MISMATCH ***')"
printf '  MIRA_BIND_SECRET     engine=%s  web=%s  %s\n' "$EB" "$WB" \
  "$([ "$EB" = "$WB" ] && echo MATCH || echo '*** MISMATCH ***')"

# e3b0c44298fc is the SHA-256 of the empty string. Seeing it means the key is
# absent or empty, NOT that it matches.
for d in "$EP" "$WP" "$EB" "$WB"; do
  [ "$d" = "e3b0c44298fc" ] && echo "  WARNING: a value is EMPTY (e3b0c44298fc is the digest of nothing)"
done

# --------------------------------------------------------------------------
say "6. End-to-end: does a real signup now reach a QR?"
TOKEN=$(curl -s -m 20 -X POST https://mira.vualet.com/api/begin \
  -H 'Content-Type: application/json' \
  -d '{"email":"provision-check@vualet.com","phone":"+971581432494","consent":{"unofficialAutomation":true,"banRisk":true,"ownAccountReplies":true}}' \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

if [ -z "$TOKEN" ]; then
  echo "  could not mint a token — signup itself is failing, look at /api/begin"
  exit 1
fi
echo "  token minted (${#TOKEN} chars)"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 25 "https://mira.vualet.com/api/pair/start?token=$TOKEN")
echo "  /api/pair/start -> $CODE"
case "$CODE" in
  302|303|307) echo "  SUCCESS — pairing is live. That redirect goes to the QR page." ;;
  503)         echo "  still 503 — a secret is missing or the two sides disagree. See step 5." ;;
  *)           echo "  unexpected $CODE — check: journalctl -u mira-web -n 40 --no-pager" ;;
esac

say "Done. Nothing above printed a secret value."
