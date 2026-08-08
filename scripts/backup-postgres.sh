#!/usr/bin/env bash
#
# Back up the OpenERP database with pg_dump, in the "custom" format (-Fc):
# compressed, and the only format pg_restore can act on selectively. This
# is a logical backup (schema + data via SQL, not a filesystem/WAL copy) —
# consistent as of a single transaction snapshot, portable across major
# PostgreSQL versions and hosts, restorable with restore-postgres.sh.
#
#   scripts/backup-postgres.sh [output-dir]
#
# Reads the source from OPENERP_BACKUP_SOURCE_URL, falling back to
# OPENERP_DATABASE_URL (the same variable the app itself reads) so the
# common case needs no extra configuration.
#
# Requires the PostgreSQL client tools (pg_dump) on PATH — not the same
# package as the server; install with e.g. `apt-get install
# postgresql-client` outside Docker, or run this from inside the
# `postgres:17-alpine` container, which already has them.
set -euo pipefail

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v pg_dump >/dev/null \
  || die "pg_dump not found — install the PostgreSQL client tools (postgresql-client)"

URL="${OPENERP_BACKUP_SOURCE_URL:-${OPENERP_DATABASE_URL:-}}"
[[ -n "${URL}" ]] || die "set OPENERP_DATABASE_URL (or OPENERP_BACKUP_SOURCE_URL)"

OUT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/backups}"
mkdir -p "${OUT_DIR}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${OUT_DIR}/openerp_${TIMESTAMP}.dump"
MASKED="$(printf '%s' "${URL}" | sed -E 's#//[^:/@]+:[^@]+@#//***:***@#')"

log "dumping ${MASKED} -> ${OUT_FILE}"
pg_dump --format=custom --file="${OUT_FILE}" "${URL}"

log "done: ${OUT_FILE} ($(du -h "${OUT_FILE}" | cut -f1))"
