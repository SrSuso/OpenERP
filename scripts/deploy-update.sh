#!/usr/bin/env bash
# Safely update the single-host production deployment.
#
# Preparation/build happens online. Once maintenance is enabled, every database
# writer is stopped before the mandatory backup and migration. Any failure from
# that point leaves maintenance enabled and stops API/worker again.
#
# Usage: scripts/deploy-update.sh [--branch <remote-branch>] [--force]
set -Eeuo pipefail

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

usage() { die "usage: $0 [--branch <remote-branch>] [--force]"; }

FORCE=0
DEPLOY_BRANCH=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE=1
      shift
      ;;
    --branch)
      [[ "$#" -ge 2 && -n "$2" && "$2" != -* ]] || usage
      DEPLOY_BRANCH="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done

for tool in git make flock; do
  command -v "${tool}" >/dev/null || die "${tool} not found on PATH"
done
[[ -d .git ]] || die "not a git checkout: ${ROOT_DIR}"
[[ -r .env.production ]] || die ".env.production is missing or unreadable"

LOCK_FILE="${OPENERP_DEPLOY_LOCK_FILE:-/tmp/openerp-production-operation.lock}"
exec 9>"${LOCK_FILE}"
flock -n 9 || die "another production deploy is already running on this host"

if [[ -n "$(git status --porcelain)" ]]; then
  die "working tree has local changes — commit, stash or discard them before deployment"
fi

STATE_DIR="${OPENERP_DEPLOY_STATE_DIR:-${ROOT_DIR}/deploy/state}"
MAINTENANCE_DIR="${OPENERP_MAINTENANCE_DIR:-${ROOT_DIR}/deploy/maintenance}"
MAINTENANCE_FLAG="${MAINTENANCE_DIR}/enabled"
mkdir -p -- "${STATE_DIR}" "${MAINTENANCE_DIR}"
chmod 700 -- "${STATE_DIR}"

MAINTENANCE_ACTIVE=0
DEPLOY_SUCCEEDED=0
on_exit() {
  status=$?
  if [[ "${status}" -ne 0 && "${MAINTENANCE_ACTIVE}" -eq 1 ]]; then
    touch -- "${MAINTENANCE_FLAG}"
    make prod-stop-writers >/dev/null 2>&1 || true
    printf '\nDEPLOYMENT FAILED: maintenance remains ON and API/worker are OFF.\n' >&2
    if [[ -s "${STATE_DIR}/last-backup" ]]; then
      printf 'Verified pre-upgrade backup: %s\n' "$(<"${STATE_DIR}/last-backup")" >&2
    fi
    printf 'Inspect the failure; either correct this release or follow the documented isolated-database rollback.\n' >&2
  fi
  if [[ "${DEPLOY_SUCCEEDED}" -eq 1 ]]; then
    log "deployment completed successfully"
  fi
}
trap on_exit EXIT

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ -n "${DEPLOY_BRANCH}" ]]; then
  git check-ref-format --branch "${DEPLOY_BRANCH}" >/dev/null \
    || die "invalid branch name: ${DEPLOY_BRANCH}"
  log "fetching requested branch origin/${DEPLOY_BRANCH}"
  git fetch --quiet origin "refs/heads/${DEPLOY_BRANCH}:refs/remotes/origin/${DEPLOY_BRANCH}" \
    || die "remote branch origin/${DEPLOY_BRANCH} does not exist or cannot be fetched"
  if git show-ref --verify --quiet "refs/heads/${DEPLOY_BRANCH}"; then
    git switch "${DEPLOY_BRANCH}"
  else
    git switch --track --create "${DEPLOY_BRANCH}" "origin/${DEPLOY_BRANCH}"
  fi
  BRANCH="${DEPLOY_BRANCH}"
elif [[ "${BRANCH}" == "HEAD" ]]; then
  die "checkout is detached; pass --branch <remote-branch>"
fi
CHECKOUT_BEFORE="$(git rev-parse HEAD)"
if [[ -s "${STATE_DIR}/current-version" ]]; then
  DEPLOYED_BEFORE="$(<"${STATE_DIR}/current-version")"
else
  DEPLOYED_BEFORE="${CHECKOUT_BEFORE}"
fi
log "preparing checkout ${ROOT_DIR} (branch ${BRANCH}, deployed ${DEPLOYED_BEFORE:0:12})"

log "git pull --ff-only origin ${BRANCH}"
git pull --ff-only origin "${BRANCH}"
TARGET_VERSION="$(git rev-parse HEAD)"

if [[ "${DEPLOYED_BEFORE}" == "${TARGET_VERSION}" && "${FORCE}" -eq 0 ]]; then
  log "already deployed at ${TARGET_VERSION:0:12}; pass --force to rebuild it"
  DEPLOY_SUCCEEDED=1
  exit 0
fi

export OPENERP_VERSION="${TARGET_VERSION}"
export OPENERP_PREVIOUS_VERSION="${DEPLOYED_BEFORE}"
export OPENERP_BACKUP_RELEASE="${DEPLOYED_BEFORE}"
export OPENERP_BACKUP_RESULT_FILE="${STATE_DIR}/last-backup"

log "preflight for target ${TARGET_VERSION:0:12}"
make prod-preflight
log "preserving the currently running images as ${DEPLOYED_BEFORE:0:12}"
make prod-preserve-current-images
log "building immutable images for ${TARGET_VERSION:0:12} while the old version remains online"
make prod-build
make prod-validate-web-config
make prod-validate-api-config

printf 'previous=%s\ntarget=%s\nstarted_at_utc=%s\n' \
  "${DEPLOYED_BEFORE}" "${TARGET_VERSION}" "$(date -u +%Y%m%dT%H%M%SZ)" \
  > "${STATE_DIR}/deployment-attempt"
chmod 600 -- "${STATE_DIR}/deployment-attempt"
printf '%s\n' "${DEPLOYED_BEFORE}" > "${STATE_DIR}/previous-version"
chmod 600 -- "${STATE_DIR}/previous-version"

log "maintenance ON"
touch -- "${MAINTENANCE_FLAG}"
MAINTENANCE_ACTIVE=1
make prod-start-maintenance-web

log "stopping every application writer (API and worker)"
make prod-stop-writers
make prod-writers-stopped

rm -f -- "${STATE_DIR}/last-backup"
log "creating and verifying mandatory pre-upgrade backup"
make prod-backup

log "migrating with target image ${TARGET_VERSION:0:12}"
make prod-migrate
make prod-migration-check

log "starting target API and web"
make prod-start-api-web
make prod-wait-api

log "running non-mutating production smoke checks"
make prod-smoke

log "starting worker only after schema/API validation"
make prod-start-worker
make prod-worker-check

printf '%s\n' "${TARGET_VERSION}" > "${STATE_DIR}/current-version"
chmod 600 -- "${STATE_DIR}/current-version"

log "maintenance OFF"
rm -f -- "${MAINTENANCE_FLAG}"
MAINTENANCE_ACTIVE=0
DEPLOY_SUCCEEDED=1

make prod-ps
