#!/usr/bin/env bash
#
# Pull the latest code and redeploy the production Docker Compose stack —
# automates docs/ADMIN_GUIDE.md's section 3.1, in the same order: pull,
# rebuild images, migrate, then recreate containers. Migrations run and
# must succeed before api/worker start (docker compose's own
# `service_completed_successfully` condition on the `migrate` service) —
# this script never leaves the app running against a half-migrated schema,
# it just fails loudly instead (set -e).
#
# Run this from a checkout that tracks the branch you want deployed —
# typically a separate clone from your dev one (e.g. ~/OpenERP-test), never
# your own working copy of unreleased changes. It refuses to run if that
# checkout has local modifications, so it never silently discards work.
#
#   scripts/deploy-update.sh [--force] [--backup]
#
# --force   redeploy even if `git pull` brought no new commits (useful
#           after editing .env.production or deploy/certs/ by hand).
# --backup  run `make prod-backup` before doing anything else.
set -euo pipefail

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

FORCE=0
BACKUP=0
for arg in "$@"; do
  case "${arg}" in
    --force) FORCE=1 ;;
    --backup) BACKUP=1 ;;
    *) die "usage: $0 [--force] [--backup]" ;;
  esac
done

command -v git >/dev/null || die "git not found on PATH"
command -v make >/dev/null || die "make not found on PATH"
[[ -d .git ]] || die "not a git checkout: ${ROOT_DIR}"

if [[ -n "$(git status --porcelain)" ]]; then
  die "working tree has local changes — this script is meant for a clean deployment checkout, not a dev copy. Commit, stash or discard them first (git status)."
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
log "checkout: ${ROOT_DIR} (branch ${BRANCH})"

if [[ "${BACKUP}" -eq 1 ]]; then
  log "backing up the database first (make prod-backup)"
  make prod-backup
fi

BEFORE="$(git rev-parse HEAD)"
log "git pull --ff-only"
git pull --ff-only
AFTER="$(git rev-parse HEAD)"

if [[ "${BEFORE}" == "${AFTER}" && "${FORCE}" -eq 0 ]]; then
  log "already up to date (${AFTER:0:12}) — nothing to redeploy. Pass --force to redeploy anyway."
  exit 0
fi

if [[ "${BEFORE}" != "${AFTER}" ]]; then
  log "updated ${BEFORE:0:12} -> ${AFTER:0:12}:"
  git --no-pager log --oneline "${BEFORE}..${AFTER}"
fi

log "make prod-build"
make prod-build

log "make prod-migrate"
make prod-migrate

log "make prod-up"
make prod-up

log "done — current status:"
make prod-ps
