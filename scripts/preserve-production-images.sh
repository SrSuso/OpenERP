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
  local service="$1" repository="$2" container image_id configured_image expected_image source_image
  container="$("${COMPOSE[@]}" ps -q "${service}")"
  if [[ -z "${container}" ]]; then
    docker image inspect "${repository}:${VERSION}" >/dev/null 2>&1 \
      || die "cannot preserve ${service}: it is not running and ${repository}:${VERSION} does not exist"
    return
  fi
  image_id="$(docker inspect --format '{{.Image}}' "${container}")"
  configured_image="$(docker inspect --format '{{.Config.Image}}' "${container}")"
  expected_image="${repository}:${VERSION}"

  # Compose v5 can expose the OCI config digest in `.Image`; that digest is
  # not always addressable through `docker image tag`, even though the
  # immutable image reference used to create the container is still local.
  # Only use that fallback when it is exactly the previous release we intend
  # to preserve: silently using `latest` could tag a newer build as the old
  # release and make rollback unsafe.
  if docker image inspect "${image_id}" >/dev/null 2>&1; then
    source_image="${image_id}"
  elif [[ "${configured_image}" == "${expected_image}" ]] \
    && docker image inspect "${configured_image}" >/dev/null 2>&1; then
    source_image="${configured_image}"
  else
    die "cannot preserve ${service}: running image is unavailable (digest ${image_id}, configured ${configured_image}, expected ${expected_image})"
  fi

  docker image tag "${source_image}" "${expected_image}"
}

preserve api openerp-backend
preserve web openerp-frontend
printf 'preserved running backend/frontend images as %s\n' "${VERSION}"
