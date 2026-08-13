#!/usr/bin/env bash
# Create and verify a portable PostgreSQL custom-format backup.
#
# Usage: scripts/backup-postgres.sh [output-directory]
#
# Connection precedence (a *_FILE value wins over its direct counterpart):
# OPENERP_BACKUP_SOURCE_URL[_FILE], then OPENERP_DATABASE_URL[_FILE]. The
# password is moved to PGPASSWORD; the URI passed in argv contains no secret.
set -Eeuo pipefail

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

source "$(dirname "${BASH_SOURCE[0]}")/lib-postgres.sh"

for tool in pg_dump pg_restore psql sha256sum; do
  command -v "${tool}" >/dev/null || die "${tool} not found — install PostgreSQL client tools"
done

URL="$(openerp_read_secret OPENERP_BACKUP_SOURCE_URL OPENERP_BACKUP_SOURCE_URL_FILE)"
if [[ -z "${URL}" ]]; then
  URL="$(openerp_read_secret OPENERP_DATABASE_URL OPENERP_DATABASE_URL_FILE)"
fi
[[ -n "${URL}" ]] || die "set OPENERP_DATABASE_URL[_FILE] or OPENERP_BACKUP_SOURCE_URL[_FILE]"
openerp_configure_pg_url "${URL}"
unset OPENERP_BACKUP_SOURCE_URL OPENERP_BACKUP_SOURCE_URL_FILE
unset OPENERP_DATABASE_URL OPENERP_DATABASE_URL_FILE URL

OUT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/backups}"
KEEP_COUNT="${OPENERP_BACKUP_KEEP_COUNT:-14}"
[[ "${KEEP_COUNT}" =~ ^[1-9][0-9]*$ ]] || die "OPENERP_BACKUP_KEEP_COUNT must be a positive integer"

umask 077
mkdir -p -- "${OUT_DIR}"
chmod 700 -- "${OUT_DIR}"

DATABASE_NAME="$(
  psql --dbname="${OPENERP_PG_URL}" --no-psqlrc -X -Atq -v ON_ERROR_STOP=1 \
    -c 'SELECT current_database()'
)"
[[ "${DATABASE_NAME}" =~ ^[A-Za-z0-9_.-]+$ ]] || die "database name is not safe for a backup filename"
ALEMBIC_REVISION="$(
  psql --dbname="${OPENERP_PG_URL}" --no-psqlrc -X -Atq -v ON_ERROR_STOP=1 \
    -c "SELECT COALESCE((SELECT version_num FROM alembic_version LIMIT 1), 'unversioned')"
)"
[[ -n "${ALEMBIC_REVISION}" ]] || ALEMBIC_REVISION="unversioned"

RELEASE="${OPENERP_BACKUP_RELEASE:-}"
if [[ -z "${RELEASE}" ]] && command -v git >/dev/null; then
  RELEASE="$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse --verify HEAD 2>/dev/null || true)"
fi
RELEASE="${RELEASE:-unknown}"
RELEASE="$(printf '%s' "${RELEASE}" | tr '\r\n' '  ' | cut -c1-120)"
RELEASE_SAFE="$(printf '%s' "${RELEASE}" | tr -cd 'A-Za-z0-9._-' | cut -c1-40)"
RELEASE_SAFE="${RELEASE_SAFE:-unknown}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE_NAME="openerp_${DATABASE_NAME}_${TIMESTAMP}_${RELEASE_SAFE}"
OUT_FILE="${OUT_DIR}/${BASE_NAME}.dump"
if [[ -e "${OUT_FILE}" ]]; then
  OUT_FILE="${OUT_DIR}/${BASE_NAME}_$$.dump"
fi
CHECKSUM_FILE="${OUT_FILE}.sha256"
METADATA_FILE="${OUT_FILE}.metadata"
TEMP_FILE="$(mktemp "${OUT_DIR}/.${BASE_NAME}.XXXXXX.tmp")"

cleanup() {
  rm -f -- "${TEMP_FILE}"
}
trap cleanup EXIT

log "creating pre-upgrade-capable backup for database ${DATABASE_NAME}"
pg_dump --dbname="${OPENERP_PG_URL}" --format=custom --no-owner --no-privileges \
  --file="${TEMP_FILE}"

[[ -s "${TEMP_FILE}" ]] || die "pg_dump produced an empty backup"
pg_restore --list "${TEMP_FILE}" >/dev/null || die "pg_restore cannot read the produced backup"
mv -- "${TEMP_FILE}" "${OUT_FILE}"
chmod 600 -- "${OUT_FILE}"

CHECKSUM="$(sha256sum -- "${OUT_FILE}" | awk '{print $1}')"
printf '%s\n' "${CHECKSUM}" > "${CHECKSUM_FILE}"
cat > "${METADATA_FILE}" <<EOF
created_at_utc=${TIMESTAMP}
database=${DATABASE_NAME}
release=${RELEASE}
alembic_revision=${ALEMBIC_REVISION}
sha256=${CHECKSUM}
EOF
chmod 600 -- "${CHECKSUM_FILE}" "${METADATA_FILE}"

if [[ -n "${OPENERP_BACKUP_RESULT_FILE:-}" ]]; then
  mkdir -p -- "$(dirname "${OPENERP_BACKUP_RESULT_FILE}")"
  printf '%s\n' "${OUT_FILE}" > "${OPENERP_BACKUP_RESULT_FILE}"
  chmod 600 -- "${OPENERP_BACKUP_RESULT_FILE}"
fi

"$(dirname "${BASH_SOURCE[0]}")/prune-postgres-backups.sh" \
  "${OUT_DIR}" "${KEEP_COUNT}" "${OUT_FILE}"

log "verified backup: ${OUT_FILE} ($(du -h "${OUT_FILE}" | cut -f1), sha256 ${CHECKSUM:0:12}…)"
