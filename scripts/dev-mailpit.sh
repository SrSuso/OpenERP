#!/usr/bin/env bash
#
# Rootless Mailpit for machines without Docker.
#
# Mailpit ships as a single static binary, so it needs no privileges.  Prefer
# `docker compose -f docker/compose.yml up -d mailpit` when Docker is available.
#
#   scripts/dev-mailpit.sh install|start|stop|status
#
# SMTP: 127.0.0.1:1025   Web UI / REST API: http://127.0.0.1:8025
#
set -euo pipefail

MAILPIT_VERSION="${MAILPIT_VERSION:-1.30.6}"
SMTP_PORT="${MAILPIT_SMTP_PORT:-1025}"
UI_PORT="${MAILPIT_UI_PORT:-8025}"

BIN="${HOME}/.local/bin/mailpit"
PIDFILE="${HOME}/.local/var/mailpit.pid"
LOGFILE="${HOME}/.local/var/log/mailpit.log"
RELEASE_BASE="https://github.com/axllent/mailpit/releases/download"

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

install_binary() {
  if [[ -x "${BIN}" ]]; then
    log "mailpit already installed ($(${BIN} version))"
    return
  fi
  command -v curl >/dev/null || die "curl is required"

  local workdir
  workdir="$(mktemp -d)"
  trap 'rm -rf "${workdir}"' RETURN

  log "downloading mailpit ${MAILPIT_VERSION}"
  curl -fsSL -o "${workdir}/mailpit.tar.gz" \
    "${RELEASE_BASE}/v${MAILPIT_VERSION}/mailpit-linux-amd64.tar.gz"
  tar -xzf "${workdir}/mailpit.tar.gz" -C "${workdir}"

  mkdir -p "$(dirname "${BIN}")"
  install -m 0755 "${workdir}/mailpit" "${BIN}"
  log "installed $(${BIN} version)"
}

is_running() {
  [[ -f "${PIDFILE}" ]] && kill -0 "$(cat "${PIDFILE}")" 2>/dev/null
}

start() {
  install_binary
  if is_running; then
    log "already running (pid $(cat "${PIDFILE}"))"
  else
    mkdir -p "$(dirname "${LOGFILE}")"
    log "starting mailpit"
    "${BIN}" \
      --smtp "127.0.0.1:${SMTP_PORT}" \
      --listen "127.0.0.1:${UI_PORT}" \
      --smtp-auth-accept-any \
      --smtp-auth-allow-insecure \
      >"${LOGFILE}" 2>&1 &
    echo $! > "${PIDFILE}"
    sleep 1
    is_running || { cat "${LOGFILE}"; die "mailpit failed to start"; }
  fi
  printf '\n  SMTP  127.0.0.1:%s\n  UI    http://127.0.0.1:%s\n\n' "${SMTP_PORT}" "${UI_PORT}"
}

stop() {
  is_running || { log "not running"; return; }
  kill "$(cat "${PIDFILE}")"
  rm -f "${PIDFILE}"
  log "stopped"
}

case "${1:-start}" in
  install) install_binary ;;
  start)   start ;;
  stop)    stop ;;
  restart) stop || true; start ;;
  status)  is_running && echo "running (pid $(cat "${PIDFILE}"))" || { echo "stopped"; exit 1; } ;;
  *)       die "usage: $0 {install|start|stop|restart|status}" ;;
esac
