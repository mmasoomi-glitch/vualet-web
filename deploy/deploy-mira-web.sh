#!/usr/bin/env bash
#
# Deploy vualet-web to its production host using the swap-directory pattern the
# host already uses, with automatic rollback on a failed health check.
#
# WHY THIS EXISTS: deploys were ad hoc. There was no script, so there was no
# tested rollback, so a reviewer refused to approve a production deploy. This is
# that script.
#
# THE TWO THINGS THAT MUST SURVIVE EVERY DEPLOY, because losing either is
# unrecoverable:
#   runtime.conf  — production configuration, NOT in git.
#   data/         — live customer records (contact.jsonl, csp-reports.jsonl,
#                   mira-state.db, veridian-mem/), untracked by git.
# Both are copied from the LIVE directory into the new release before the swap,
# and never taken from the git checkout.
#
set -euo pipefail
IFS=$'\n\t'

APP_DIR="${APP_DIR:-/opt/mira-web}"
SERVICE="${SERVICE:-mira-web}"
OWNER="${OWNER:-mira-web:mira-web}"
REPO_URL="${REPO_URL:-https://github.com/mmasoomi-glitch/vualet-web.git}"
BRANCH="${BRANCH:-main}"
BUILD_ROOT="${BUILD_ROOT:-/opt/mira-web-build}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "must be run as root"

# ── pre-flight. Nothing is touched until every one of these passes ──────────
log "pre-flight checks"
[[ -d "${APP_DIR}" ]]                || die "live directory ${APP_DIR} does not exist"
log "  ok  live directory exists"
[[ -f "${APP_DIR}/runtime.conf" ]]   || die "runtime.conf missing in ${APP_DIR} — refusing to deploy without production config"
log "  ok  runtime.conf present"
[[ -d "${APP_DIR}/data" ]]           || die "data/ missing in ${APP_DIR} — refusing to deploy without customer data"
log "  ok  data/ present"
systemctl list-unit-files "${SERVICE}.service" >/dev/null 2>&1 || die "systemd unit ${SERVICE} not found"
log "  ok  systemd unit ${SERVICE} exists"
for cmd in git node npm curl; do
  command -v "${cmd}" >/dev/null 2>&1 || die "${cmd} not found in PATH"
done
log "  ok  git, node, npm, curl available"
AVAIL_KB="$(df --output=avail "${APP_DIR}" | tail -n 1 | tr -d ' ')"
[[ "${AVAIL_KB}" -ge 2097152 ]] || die "insufficient disk: ${AVAIL_KB} KB free, need 2 GB"
log "  ok  disk space (${AVAIL_KB} KB free)"

# The health URL is derived from the LIVE runtime.conf, never guessed. The app
# listens on PORT from that file; hard-coding 3000 would fail every health check
# and roll back every good deploy.
LIVE_PORT="$(grep -oE '^PORT=[0-9]+' "${APP_DIR}/runtime.conf" | head -1 | cut -d= -f2 || true)"
[[ -n "${LIVE_PORT}" ]] || die "could not read PORT from ${APP_DIR}/runtime.conf"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${LIVE_PORT}/}"
log "  ok  health url ${HEALTH_URL}"

# ── build, in a scratch directory. A failed build must leave the site alone ──
mkdir -p "${BUILD_ROOT}"
BUILD_DIR="$(mktemp -d "${BUILD_ROOT}/build-XXXXXX")"
CLEANUP_BUILD=1
cleanup() { [[ "${CLEANUP_BUILD}" -eq 1 && -d "${BUILD_DIR}" ]] && rm -rf "${BUILD_DIR}"; }
trap cleanup EXIT

log "cloning ${BRANCH} into ${BUILD_DIR}"
git clone --branch "${BRANCH}" --depth 1 "${REPO_URL}" "${BUILD_DIR}"
NEW_SHA="$(git -C "${BUILD_DIR}" rev-parse --short HEAD)"
log "resolved ${BRANCH} -> ${NEW_SHA}"

log "npm ci"
( cd "${BUILD_DIR}" && npm ci --no-audit --no-fund )
log "npm run build"
( cd "${BUILD_DIR}" && npm run build )

# ── carry live state forward. FROM THE LIVE DIRECTORY, never from git ───────
log "carrying runtime.conf and data/ forward from ${APP_DIR}"
cp -a "${APP_DIR}/runtime.conf" "${BUILD_DIR}/runtime.conf"
rm -rf "${BUILD_DIR}/data"
cp -a "${APP_DIR}/data" "${BUILD_DIR}/data"
[[ -f "${BUILD_DIR}/runtime.conf" ]] || die "runtime.conf did not copy — aborting before the swap"
[[ -d "${BUILD_DIR}/data" ]]         || die "data/ did not copy — aborting before the swap"
log "  ok  state carried forward"

# ── swap. The only step that touches the live site. Keep it short ───────────
OLD_SHA="$(head -n 1 "${APP_DIR}/DEPLOYED_COMMIT" 2>/dev/null | tr -d '[:space:]' || true)"
[[ -n "${OLD_SHA}" ]] || OLD_SHA="unknown-$(date +%s)"
PREV_DIR="${APP_DIR}-prev-${OLD_SHA}"
[[ -e "${PREV_DIR}" ]] && PREV_DIR="${APP_DIR}-prev-${OLD_SHA}-$(date +%s)"

log "stopping ${SERVICE}"
systemctl stop "${SERVICE}"
log "mv ${APP_DIR} -> ${PREV_DIR}"
mv "${APP_DIR}" "${PREV_DIR}"
log "mv ${BUILD_DIR} -> ${APP_DIR}"
mv "${BUILD_DIR}" "${APP_DIR}"
CLEANUP_BUILD=0   # it is the live directory now; the trap must not remove it
echo "${NEW_SHA}" > "${APP_DIR}/DEPLOYED_COMMIT"
log "chown -R ${OWNER} ${APP_DIR}"
chown -R "${OWNER}" "${APP_DIR}"
log "starting ${SERVICE}"
systemctl start "${SERVICE}"

# ── verify, and roll back automatically if it does not come up ──────────────
log "health checking ${HEALTH_URL}"
HEALTH_OK=0
for i in $(seq 1 30); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${HEALTH_URL}" || true)"
  if [[ "${CODE}" == "200" ]]; then HEALTH_OK=1; log "  ok  healthy after ${i} attempt(s)"; break; fi
  log "  .. attempt ${i}/30 got '${CODE}', retrying in 2s"
  sleep 2
done

if [[ "${HEALTH_OK}" -ne 1 ]]; then
  log "HEALTH CHECK FAILED — rolling back automatically"
  systemctl stop "${SERVICE}" || true
  FAILED_DIR="${APP_DIR}-failed-${NEW_SHA}"
  log "mv ${APP_DIR} -> ${FAILED_DIR}"
  mv "${APP_DIR}" "${FAILED_DIR}"
  log "mv ${PREV_DIR} -> ${APP_DIR}"
  mv "${PREV_DIR}" "${APP_DIR}"
  chown -R "${OWNER}" "${APP_DIR}"
  systemctl start "${SERVICE}"
  for i in $(seq 1 10); do
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${HEALTH_URL}" || true)"
    [[ "${CODE}" == "200" ]] && { log "rollback healthy"; break; }
    sleep 2
  done
  echo "" >&2
  echo "DEPLOY FAILED AND WAS ROLLED BACK" >&2
  echo "  previous (restored): ${OLD_SHA}" >&2
  echo "  failed (kept at):    ${FAILED_DIR}" >&2
  exit 1
fi

# ── prune. Newest KEEP_RELEASES survive; the one just created is newest ─────
mapfile -t RELEASES < <(ls -td "${APP_DIR}-prev-"* 2>/dev/null || true)
if (( ${#RELEASES[@]} > KEEP_RELEASES )); then
  for (( i=KEEP_RELEASES; i<${#RELEASES[@]}; i++ )); do
    D="${RELEASES[$i]}"
    case "${D}" in
      "${APP_DIR}-prev-"*) log "pruning ${D}"; rm -rf "${D}" ;;
      *) log "refusing to prune unexpected path ${D}" ;;
    esac
  done
fi

log "=============================================="
log "DEPLOY OK   ${OLD_SHA} -> ${NEW_SHA}"
log "service ${SERVICE}: $(systemctl is-active "${SERVICE}")"
log "health: 200 at ${HEALTH_URL}"
log "roll back with:"
log "  systemctl stop ${SERVICE} && mv ${APP_DIR} ${APP_DIR}-failed-${NEW_SHA} && mv ${PREV_DIR} ${APP_DIR} && chown -R ${OWNER} ${APP_DIR} && systemctl start ${SERVICE}"
log "=============================================="
