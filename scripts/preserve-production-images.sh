#!/usr/bin/env bash
# Tag the images of the running API/web containers with the previous commit.
set -Eeuo pipefail

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

VERSION="${1:-}"
[[ "${VERSION}" =~ ^[A-Fa-f0-9]{7,64}$ ]] || die "previous version must be a commit-like tag"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"
COMPOSE=(docker compose -f docker/compose.prod.yml --env-file .env.production)

preserve() {
  local service="$1" repository="$2" container image_id
  container="$("${COMPOSE[@]}" ps -q "${service}")"
  if [[ -z "${container}" ]]; then
    docker image inspect "${repository}:${VERSION}" >/dev/null 2>&1 \
      || die "cannot preserve ${service}: it is not running and ${repository}:${VERSION} does not exist"
    return
  fi
  image_id="$(docker inspect --format '{{.Image}}' "${container}")"
  docker image tag "${image_id}" "${repository}:${VERSION}"
}

preserve api openerp-backend
preserve web openerp-frontend
printf 'preserved running backend/frontend images as %s\n' "${VERSION}"
