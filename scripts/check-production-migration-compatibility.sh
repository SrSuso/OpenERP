#!/usr/bin/env bash
# Refuse a deployment before maintenance when its Alembic graph cannot identify
# the revision recorded by production. This happens when a feature-branch
# database is pointed back at an older stable branch.
set -Eeuo pipefail

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSIONS_DIR="${ROOT_DIR}/backend/migrations/versions"
BRANCH="$(git -C "${ROOT_DIR}" rev-parse --abbrev-ref HEAD)"

[[ -d "${VERSIONS_DIR}" ]] || die "Alembic versions directory is missing"
mapfile -t DATABASE_REVISIONS < <("${ROOT_DIR}/scripts/production-database.sh" current-revision)
[[ "${#DATABASE_REVISIONS[@]}" -gt 0 ]] || die "production database returned no Alembic revision"

for database_revision in "${DATABASE_REVISIONS[@]}"; do
  if [[ "${database_revision}" == "unversioned" ]]; then
    log "production database is not initialized yet; target migrations may create it"
    continue
  fi
  [[ "${database_revision}" =~ ^[A-Za-z0-9_]+$ ]] \
    || die "production database returned an invalid Alembic revision"

  revision_found=0
  while IFS= read -r migration_file; do
    if grep -Eq \
      "^[[:space:]]*revision([[:space:]]*:[^=]+)?[[:space:]]*=[[:space:]]*['\"]${database_revision}['\"]" \
      "${migration_file}"; then
      revision_found=1
      break
    fi
  done < <(find "${VERSIONS_DIR}" -maxdepth 1 -type f -name '*.py' -print)

  if [[ "${revision_found}" -ne 1 ]]; then
    die "database revision ${database_revision} is not present in target branch ${BRANCH}. Refusing before maintenance: deploy the compatible branch to recover service, or restore/convert an isolated database for this branch. Do not edit alembic_version or copy feature migrations into the stable branch."
  fi
done

log "production database revision is present in branch ${BRANCH}"
