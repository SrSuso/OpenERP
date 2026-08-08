#!/usr/bin/env bash
#
# Restore a custom-format backup produced by backup-postgres.sh.
#
#   scripts/restore-postgres.sh <dump-file> [target-url] [--yes]
#
# Destructive: --clean drops every object the dump knows about — inside
# the *target* database only — before recreating it and loading the data.
# There is no undo once that happens, so this refuses to run without
# either --yes or a typed "yes" at an interactive prompt.
#
# --no-owner --no-privileges: a restore commonly lands on a different host
# (disaster recovery) or under a different role than the one that produced
# the dump; without these flags pg_restore tries to `ALTER ... OWNER TO`
# and `GRANT` to roles that may not exist there, and fails on that instead
# of on anything that actually matters. Ownership/grants on this schema
# are uniform (a single application role) and not part of what a backup
# is meant to preserve.
#
# Requires the PostgreSQL client tools (pg_restore) on PATH — see
# backup-postgres.sh's own header for where to get them.
set -euo pipefail

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v pg_restore >/dev/null \
  || die "pg_restore not found — install the PostgreSQL client tools (postgresql-client)"

DUMP_FILE="${1:-}"
[[ -n "${DUMP_FILE}" ]] || die "usage: $0 <dump-file> [target-url] [--yes]"
[[ -f "${DUMP_FILE}" ]] || die "no such file: ${DUMP_FILE}"

TARGET_URL="${OPENERP_DATABASE_URL:-}"
if [[ "${2:-}" != "--yes" && -n "${2:-}" ]]; then
  TARGET_URL="$2"
fi
[[ -n "${TARGET_URL}" ]] || die "no target: pass a URL as the 2nd argument or set OPENERP_DATABASE_URL"

ASSUME_YES=0
for arg in "$@"; do
  [[ "${arg}" == "--yes" ]] && ASSUME_YES=1
done

MASKED="$(printf '%s' "${TARGET_URL}" | sed -E 's#//[^:/@]+:[^@]+@#//***:***@#')"
if [[ "${ASSUME_YES}" -ne 1 ]]; then
  printf 'This will DROP and recreate every object in %s\nType "yes" to continue: ' "${MASKED}"
  read -r reply
  [[ "${reply}" == "yes" ]] || die "aborted"
fi

log "restoring ${DUMP_FILE} -> ${MASKED}"
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="${TARGET_URL}" "${DUMP_FILE}"

log "done"
