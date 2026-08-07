#!/usr/bin/env bash
#
# Playwright browser dependencies without root.
#
# `npx playwright install --with-deps` needs apt and administrator rights.  On a
# machine without them, this fetches the same libraries with `apt-get download`
# (which does not need root), unpacks them under ~/.local, and installs the
# fonts Chromium needs to lay text out — without them every element measures
# 0px tall and Playwright reports perfectly rendered content as "hidden".
#
#   scripts/dev-browsers.sh install
#   source scripts/env.sh   # exports LD_LIBRARY_PATH
#
# CI keeps using `npx playwright install --with-deps chromium`.
#
set -euo pipefail

LIB_PREFIX="${HOME}/.local/opt/chromium-libs"
LIB_DIR="${LIB_PREFIX}/usr/lib/x86_64-linux-gnu"
FONT_DIR="${HOME}/.local/share/fonts"

# Runtime libraries chrome-headless-shell links against that a minimal Ubuntu
# image does not ship.
LIB_PACKAGES=(
  libasound2t64
  libatk1.0-0t64
  libatk-bridge2.0-0t64
  libatspi2.0-0t64
  libgbm1
  libxcomposite1
  libxdamage1
  libxfixes3
  libxi6
  libxrandr2
  libxrender1
  libxres1
)

FONT_PACKAGES=(fonts-liberation fonts-dejavu-core)

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

install_debs() {
  local target="$1"; shift
  local workdir
  workdir="$(mktemp -d)"
  trap 'rm -rf "${workdir}"' RETURN

  ( cd "${workdir}" && apt-get download "$@" >/dev/null )
  mkdir -p "${target}"
  for deb in "${workdir}"/*.deb; do
    dpkg-deb -x "${deb}" "${target}"
  done
}

install() {
  command -v apt-get >/dev/null || die "apt-get is required (Debian/Ubuntu only)"
  command -v dpkg-deb >/dev/null || die "dpkg-deb is required"

  log "downloading Chromium runtime libraries"
  install_debs "${LIB_PREFIX}" "${LIB_PACKAGES[@]}"

  log "installing fonts into ${FONT_DIR}"
  local staging
  staging="$(mktemp -d)"
  install_debs "${staging}" "${FONT_PACKAGES[@]}"
  mkdir -p "${FONT_DIR}"
  find "${staging}" \( -name '*.ttf' -o -name '*.otf' \) -exec cp -n {} "${FONT_DIR}/" \;
  rm -rf "${staging}"
  command -v fc-cache >/dev/null && fc-cache -f >/dev/null 2>&1 || true

  verify
}

verify() {
  local browser
  browser="$(find "${HOME}/.cache/ms-playwright" -name 'chrome-headless-shell' -type f 2>/dev/null | head -1)"
  [[ -n "${browser}" ]] || die "Chromium not installed yet — run: npx playwright install chromium"

  local missing
  missing="$(LD_LIBRARY_PATH="${LIB_DIR}" ldd "${browser}" 2>&1 | grep 'not found' || true)"
  [[ -z "${missing}" ]] || die "still missing:\n${missing}"

  local font_count
  font_count="$(find "${FONT_DIR}" -name '*.ttf' 2>/dev/null | wc -l)"
  (( font_count > 0 )) || die "no fonts installed; text would measure 0px and every locator would look hidden"

  log "chromium dependencies satisfied (${font_count} fonts)"
  printf '\n  export LD_LIBRARY_PATH=%s:$LD_LIBRARY_PATH\n\n' "${LIB_DIR}"
}

case "${1:-install}" in
  install) install ;;
  verify)  verify ;;
  *)       die "usage: $0 {install|verify}" ;;
esac
