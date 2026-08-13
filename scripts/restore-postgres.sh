#!/usr/bin/env bash
# Restore a verified dump into a brand-new database on the configured server.
#
# Usage: scripts/restore-postgres.sh <dump-file> --target-database <new-name>
#
# The configured database is only a connection anchor and is never modified.
# OPENERP_RESTORE_SERVER_URL[_FILE] overrides OPENERP_DATABASE_URL[_FILE].
set -Eeuo pipefail

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

source "$(dirname "${BASH_SOURCE[0]}")/lib-postgres.sh"

DUMP_FILE="${1:-}"
shift || true
TARGET_DATABASE=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --target-database)
      [[ "$#" -ge 2 ]] || die "--target-database requires a value"
      TARGET_DATABASE="$2"
      shift 2
      ;;
    *) die "usage: $0 <dump-file> --target-database <new-name>" ;;
  esac
done

[[ -f "${DUMP_FILE}" && ! -L "${DUMP_FILE}" ]] || die "dump must be a regular, non-symlink file"
[[ "${TARGET_DATABASE}" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] \
  || die "target database must be a new, simple PostgreSQL identifier"

for tool in flock pg_restore psql sha256sum; do
  command -v "${tool}" >/dev/null || die "${tool} not found — install PostgreSQL client tools"
done

LOCK_FILE="${OPENERP_RESTORE_LOCK_FILE:-/tmp/openerp-production-operation.lock}"
exec 9>"${LOCK_FILE}"
flock -n 9 || die "another restore is already running on this host"

BASE_URL="$(openerp_read_secret OPENERP_RESTORE_SERVER_URL OPENERP_RESTORE_SERVER_URL_FILE)"
if [[ -z "${BASE_URL}" ]]; then
  BASE_URL="$(openerp_read_secret OPENERP_DATABASE_URL OPENERP_DATABASE_URL_FILE)"
fi
[[ -n "${BASE_URL}" ]] || die "set OPENERP_DATABASE_URL[_FILE] or OPENERP_RESTORE_SERVER_URL[_FILE]"
openerp_configure_pg_url "${BASE_URL}"
BASE_SAFE_URL="${OPENERP_PG_URL}"
unset OPENERP_RESTORE_SERVER_URL OPENERP_RESTORE_SERVER_URL_FILE
unset OPENERP_DATABASE_URL OPENERP_DATABASE_URL_FILE BASE_URL

CHECKSUM_FILE="${DUMP_FILE}.sha256"
METADATA_FILE="${DUMP_FILE}.metadata"
[[ -s "${CHECKSUM_FILE}" && ! -L "${CHECKSUM_FILE}" ]] || die "backup checksum sidecar is missing"
[[ -s "${METADATA_FILE}" && ! -L "${METADATA_FILE}" ]] || die "backup metadata sidecar is missing"
EXPECTED_CHECKSUM="$(head -n 1 "${CHECKSUM_FILE}")"
[[ "${EXPECTED_CHECKSUM}" =~ ^[0-9a-f]{64}$ ]] || die "backup checksum sidecar is invalid"
ACTUAL_CHECKSUM="$(sha256sum -- "${DUMP_FILE}" | awk '{print $1}')"
[[ "${ACTUAL_CHECKSUM}" == "${EXPECTED_CHECKSUM}" ]] || die "backup checksum does not match"
pg_restore --list "${DUMP_FILE}" >/dev/null || die "pg_restore cannot read this backup"

SOURCE_DATABASE="$(
  psql --dbname="${BASE_SAFE_URL}" --no-psqlrc -X -Atq -v ON_ERROR_STOP=1 \
    -c 'SELECT current_database()'
)"
[[ "${TARGET_DATABASE}" != "${SOURCE_DATABASE}" ]] \
  || die "refusing to restore over the configured live database ${SOURCE_DATABASE}"

TARGET_EXISTS="$(
  psql --dbname="${BASE_SAFE_URL}" --no-psqlrc -X -Atq -v ON_ERROR_STOP=1 \
    -c "SELECT count(*) FROM pg_database WHERE datname = '${TARGET_DATABASE}'"
)"
if [[ "${TARGET_EXISTS}" != "0" ]]; then
  CONNECTIONS="$(
    psql --dbname="${BASE_SAFE_URL}" --no-psqlrc -X -Atq -v ON_ERROR_STOP=1 \
      -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '${TARGET_DATABASE}'"
  )"
  die "target database ${TARGET_DATABASE} already exists (${CONNECTIONS} connection(s)); choose a new name"
fi

TARGET_URL="$(openerp_pg_url_for_database "${BASE_SAFE_URL}" "${TARGET_DATABASE}")"

RESTORE_COMPLETE=0
on_exit() {
  status=$?
  if [[ "${status}" -ne 0 && "${RESTORE_COMPLETE}" -eq 0 ]]; then
    printf 'restore failed; isolated database %s may be incomplete and was not connected to the application\n' \
      "${TARGET_DATABASE}" >&2
  fi
}
trap on_exit EXIT

log "creating isolated database ${TARGET_DATABASE} (configured database ${SOURCE_DATABASE} remains untouched)"
psql --dbname="${BASE_SAFE_URL}" --no-psqlrc -X -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"${TARGET_DATABASE}\"" >/dev/null

log "restoring verified backup into ${TARGET_DATABASE}"
pg_restore --dbname="${TARGET_URL}" --exit-on-error --no-owner --no-privileges "${DUMP_FILE}"

psql --dbname="${TARGET_URL}" --no-psqlrc -X -Atq -v ON_ERROR_STOP=1 -c 'SELECT 1' \
  >/dev/null
MISSING_TABLES="$(
  psql --dbname="${TARGET_URL}" --no-psqlrc -X -Atq -v ON_ERROR_STOP=1 -c \
    "SELECT count(*) FROM (VALUES (to_regclass('public.users')), (to_regclass('public.products')), (to_regclass('public.sales')), (to_regclass('public.alembic_version'))) AS required(name) WHERE name IS NULL"
)"
[[ "${MISSING_TABLES}" == "0" ]] || die "restored database is missing critical tables"

EXPECTED_REVISION="$(sed -n 's/^alembic_revision=//p' "${METADATA_FILE}" | head -n 1)"
RESTORED_REVISION="$(
  psql --dbname="${TARGET_URL}" --no-psqlrc -X -Atq -v ON_ERROR_STOP=1 \
    -c 'SELECT version_num FROM alembic_version LIMIT 1'
)"
[[ -n "${EXPECTED_REVISION}" && "${RESTORED_REVISION}" == "${EXPECTED_REVISION}" ]] \
  || die "restored Alembic revision does not match backup metadata"

COUNTS="$(
  psql --dbname="${TARGET_URL}" --no-psqlrc -X -Atq -F, -v ON_ERROR_STOP=1 -c \
    "SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM products), (SELECT count(*) FROM sales)"
)"
RESTORE_COMPLETE=1
log "verified restore: database=${TARGET_DATABASE}, revision=${RESTORED_REVISION}, users/products/sales=${COUNTS}"
printf 'NEXT: configure the matching application release to use database %s, run smoke checks, then perform the controlled cutover.\n' \
  "${TARGET_DATABASE}"
