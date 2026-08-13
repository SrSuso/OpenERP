#!/usr/bin/env bash
# Keep the newest N OpenERP dumps in one explicitly supplied directory.
set -Eeuo pipefail

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

DIRECTORY="${1:-}"
KEEP_COUNT="${2:-}"
PROTECTED_FILE="${3:-}"
[[ -n "${DIRECTORY}" && -d "${DIRECTORY}" ]] || die "backup directory does not exist"
[[ "${KEEP_COUNT}" =~ ^[1-9][0-9]*$ ]] || die "keep count must be a positive integer"

DIRECTORY="$(cd "${DIRECTORY}" && pwd -P)"
if [[ -n "${PROTECTED_FILE}" ]]; then
  PROTECTED_FILE="$(cd "$(dirname "${PROTECTED_FILE}")" && pwd -P)/$(basename "${PROTECTED_FILE}")"
  [[ "${PROTECTED_FILE}" == "${DIRECTORY}/"* ]] || die "protected backup is outside the backup directory"
fi

mapfile -t DUMPS < <(
  find -P "${DIRECTORY}" -maxdepth 1 -type f \
    -name 'openerp_*.dump' -printf '%f\n' | LC_ALL=C sort -r
)

kept=0
for basename in "${DUMPS[@]}"; do
  [[ "${basename}" =~ ^openerp_[A-Za-z0-9_.-]+\.dump$ ]] || continue
  dump="${DIRECTORY}/${basename}"
  [[ ! -L "${dump}" ]] || continue
  if [[ "${dump}" == "${PROTECTED_FILE}" || "${kept}" -lt "${KEEP_COUNT}" ]]; then
    kept=$((kept + 1))
    continue
  fi
  rm -f -- "${dump}" "${dump}.sha256" "${dump}.metadata"
done
