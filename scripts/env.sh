# Shell environment for local development.  Source it, do not execute it:
#
#   source scripts/env.sh
#
# Adds the toolchain installed under ~/.local to PATH.  Harmless if you got
# node/uv/postgres from your package manager instead — those simply stay first.

for _dir in \
  "${HOME}/.local/bin" \
  "${HOME}/.local/opt/node/bin" \
  "${HOME}/.local/opt/pgsql/bin"
do
  case ":${PATH}:" in
    *":${_dir}:"*) ;;
    *) [ -d "${_dir}" ] && PATH="${_dir}:${PATH}" ;;
  esac
done
unset _dir
export PATH

# Point the app at the rootless cluster started by scripts/dev-postgres.sh.
# Override freely (e.g. to 5432 when using Docker Compose).
export OPENERP_DATABASE_URL="${OPENERP_DATABASE_URL:-postgresql://openerp:openerp@127.0.0.1:55432/openerp}"
export OPENERP_TEST_DATABASE_URL="${OPENERP_TEST_DATABASE_URL:-postgresql://openerp:openerp@127.0.0.1:55432/postgres}"
export OPENERP_ENVIRONMENT="${OPENERP_ENVIRONMENT:-local}"
export OPENERP_LOG_FORMAT="${OPENERP_LOG_FORMAT:-console}"

# Chromium runtime libraries unpacked by scripts/dev-browsers.sh (only needed
# on machines where `playwright install --with-deps` could not run).
_chromium_libs="${HOME}/.local/opt/chromium-libs/usr/lib/x86_64-linux-gnu"
if [ -d "${_chromium_libs}" ]; then
  case ":${LD_LIBRARY_PATH:-}:" in
    *":${_chromium_libs}:"*) ;;
    *) export LD_LIBRARY_PATH="${_chromium_libs}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}" ;;
  esac
fi
unset _chromium_libs

