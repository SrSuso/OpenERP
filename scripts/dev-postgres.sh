#!/usr/bin/env bash
#
# Rootless PostgreSQL for machines without Docker.
#
# Downloads the official PostgreSQL server binaries (Zonky's embedded build)
# into ~/.local/opt/pgsql and runs a cluster out of ~/.local/var, so no
# administrator rights and no system packages are needed.
#
# Prefer `docker compose -f docker/compose.yml up -d postgres` when Docker is
# available; this script exists so the test suite can still run on a real
# PostgreSQL when it is not.
#
#   scripts/dev-postgres.sh install|start|stop|status|url
#
set -euo pipefail

PG_VERSION="${PG_VERSION:-17.10.0}"
PG_PORT="${PG_PORT:-55432}"
PG_USER="${PG_USER:-openerp}"
PG_PASSWORD="${PG_PASSWORD:-openerp}"
PG_DATABASE="${PG_DATABASE:-openerp}"

PREFIX="${HOME}/.local/opt/pgsql"
PGDATA="${HOME}/.local/var/pgdata"
LOGFILE="${HOME}/.local/var/log/postgres.log"
MAVEN_BASE="https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-linux-amd64"

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

install_binaries() {
  if [[ -x "${PREFIX}/bin/postgres" ]]; then
    log "PostgreSQL already installed at ${PREFIX} ($(${PREFIX}/bin/postgres --version))"
    return
  fi

  command -v curl >/dev/null || die "curl is required"
  command -v tar >/dev/null || die "tar is required"

  local workdir
  workdir="$(mktemp -d)"
  trap 'rm -rf "${workdir}"' RETURN

  log "downloading PostgreSQL ${PG_VERSION} binaries"
  curl -fsSL -o "${workdir}/pg.jar" \
    "${MAVEN_BASE}/${PG_VERSION}/embedded-postgres-binaries-linux-amd64-${PG_VERSION}.jar"

  # The jar is a zip containing a single .txz of the binaries.
  python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" \
    "${workdir}/pg.jar" "${workdir}/extracted"

  mkdir -p "${PREFIX}"
  tar -xJf "${workdir}/extracted/postgres-linux-x86_64.txz" -C "${PREFIX}"

  log "installed $(${PREFIX}/bin/postgres --version) to ${PREFIX}"
}

init_cluster() {
  [[ -f "${PGDATA}/PG_VERSION" ]] && return

  log "initialising cluster at ${PGDATA}"
  mkdir -p "${PGDATA}" "$(dirname "${LOGFILE}")"
  local pwfile
  pwfile="$(mktemp)"
  printf '%s' "${PG_PASSWORD}" > "${pwfile}"
  "${PREFIX}/bin/initdb" -D "${PGDATA}" -U "${PG_USER}" --pwfile="${pwfile}" \
    -E UTF8 --locale=C >/dev/null
  rm -f "${pwfile}"
}

is_running() {
  "${PREFIX}/bin/pg_ctl" -D "${PGDATA}" status >/dev/null 2>&1
}

start() {
  install_binaries
  init_cluster

  if is_running; then
    log "already running on port ${PG_PORT}"
  else
    log "starting on 127.0.0.1:${PG_PORT}"
    "${PREFIX}/bin/pg_ctl" -D "${PGDATA}" -l "${LOGFILE}" \
      -o "-p ${PG_PORT} -k /tmp -c listen_addresses=127.0.0.1" -w start
  fi

  # createdb is not shipped with these binaries; the Python helper does it.
  ( cd "$(dirname "$0")/../backend" \
    && OPENERP_DATABASE_URL="$(url)" uv run python -m scripts.devdb create )

  printf '\n  OPENERP_DATABASE_URL=%s\n\n' "$(url)"
}

stop() {
  is_running || { log "not running"; return; }
  "${PREFIX}/bin/pg_ctl" -D "${PGDATA}" -m fast -w stop
}

status() {
  if is_running; then
    "${PREFIX}/bin/pg_ctl" -D "${PGDATA}" status
  else
    echo "stopped"
    return 1
  fi
}

url() {
  printf 'postgresql://%s:%s@127.0.0.1:%s/%s' \
    "${PG_USER}" "${PG_PASSWORD}" "${PG_PORT}" "${PG_DATABASE}"
}

case "${1:-start}" in
  install) install_binaries ;;
  start)   start ;;
  stop)    stop ;;
  restart) stop || true; start ;;
  status)  status ;;
  url)     url; echo ;;
  *)       die "usage: $0 {install|start|stop|restart|status|url}" ;;
esac
