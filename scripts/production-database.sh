#!/usr/bin/env bash
# Resolve the production DB URL without logging it, then run backup/restore.
set -Eeuo pipefail

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${OPENERP_PRODUCTION_ENV_FILE:-${ROOT_DIR}/.env.production}"
[[ -r "${ENV_FILE}" ]] || die "production env file is missing or unreadable"

env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n 1 | tr -d '\r'
}

resolve_url() {
  local direct_value="${OPENERP_DATABASE_URL:-}" file_path="${OPENERP_DATABASE_URL_FILE:-}"
  [[ -n "${direct_value}" ]] || direct_value="$(env_value OPENERP_DATABASE_URL)"
  [[ -n "${file_path}" ]] || file_path="$(env_value OPENERP_DATABASE_URL_FILE)"
  if [[ -n "${file_path}" ]]; then
    [[ -r "${file_path}" ]] \
      || die "OPENERP_DATABASE_URL_FILE is not host-readable; provide OPENERP_BACKUP_SOURCE_URL_FILE or OPENERP_RESTORE_SERVER_URL_FILE"
    IFS= read -r direct_value < "${file_path}" || true
  fi
  [[ -n "${direct_value}" ]] || die "OPENERP_DATABASE_URL[_FILE] is not configured"
  # The application reaches Compose by service name; host-side pg tools use
  # the loopback-only port published by docker/compose.prod.yml.
  printf '%s' "${direct_value/@postgres:/@127.0.0.1:}"
}

MODE="${1:-}"
shift || true
case "${MODE}" in
  backup)
    if [[ -z "${OPENERP_BACKUP_KEEP_COUNT:-}" ]]; then
      OPENERP_BACKUP_KEEP_COUNT="$(env_value OPENERP_BACKUP_KEEP_COUNT)"
      export OPENERP_BACKUP_KEEP_COUNT="${OPENERP_BACKUP_KEEP_COUNT:-14}"
    fi
    if [[ -z "${OPENERP_BACKUP_SOURCE_URL:-}" && -z "${OPENERP_BACKUP_SOURCE_URL_FILE:-}" ]]; then
      export OPENERP_BACKUP_SOURCE_URL="$(resolve_url)"
    fi
    exec "${ROOT_DIR}/scripts/backup-postgres.sh" "$@"
    ;;
  restore)
    if [[ -z "${OPENERP_RESTORE_SERVER_URL:-}" && -z "${OPENERP_RESTORE_SERVER_URL_FILE:-}" ]]; then
      export OPENERP_RESTORE_SERVER_URL="$(resolve_url)"
    fi
    exec "${ROOT_DIR}/scripts/restore-postgres.sh" "$@"
    ;;
  current-revision)
    command -v psql >/dev/null || die "psql not found — install PostgreSQL client tools"
    source "${ROOT_DIR}/scripts/lib-postgres.sh"
    URL="$(resolve_url)"
    openerp_configure_pg_url "${URL}"
    unset OPENERP_DATABASE_URL OPENERP_DATABASE_URL_FILE URL
    VERSION_TABLE="$({
      psql --dbname="${OPENERP_PG_URL}" --no-psqlrc -X -Atq -v ON_ERROR_STOP=1 \
        -c "SELECT COALESCE(to_regclass('public.alembic_version')::text, '')"
    })"
    if [[ -z "${VERSION_TABLE}" ]]; then
      printf 'unversioned\n'
    else
      psql --dbname="${OPENERP_PG_URL}" --no-psqlrc -X -Atq -v ON_ERROR_STOP=1 \
        -c "SELECT version_num FROM alembic_version ORDER BY version_num"
    fi
    ;;
  *)
    die "usage: $0 backup [directory] | restore <dump> --target-database <new-name> | current-revision"
    ;;
esac
