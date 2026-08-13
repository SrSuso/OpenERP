#!/usr/bin/env bash
# Non-mutating smoke checks used while public maintenance mode is still on.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"
COMPOSE=(docker compose -f docker/compose.prod.yml --env-file .env.production)

"${COMPOSE[@]}" exec -T api uv run python -c \
  "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health/ready', timeout=5).read()"

CURRENT="$("${COMPOSE[@]}" run --rm --no-deps migrate uv run alembic current)"
[[ "${CURRENT}" == *"(head)"* ]] || {
  printf 'error: database is not at the Alembic head\n' >&2
  exit 1
}

"${COMPOSE[@]}" exec -T web wget --spider -q http://127.0.0.1/healthz
printf 'production smoke checks passed (API ready, database at head, web healthy)\n'
