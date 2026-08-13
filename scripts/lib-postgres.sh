#!/usr/bin/env bash
# Shared, side-effect-light helpers for PostgreSQL operational scripts.

openerp_read_secret() {
  local direct_name="$1" file_name="$2" direct_value file_path
  direct_value="${!direct_name:-}"
  file_path="${!file_name:-}"
  if [[ -n "${file_path}" ]]; then
    [[ -r "${file_path}" ]] || {
      printf 'error: %s is not readable\n' "${file_name}" >&2
      return 1
    }
    IFS= read -r direct_value < "${file_path}" || true
  fi
  printf '%s' "${direct_value}"
}

openerp_configure_pg_url() {
  local raw_url="$1" scheme remainder authority path userinfo server encoded_password decoded
  raw_url="${raw_url/postgresql+psycopg:\/\//postgresql://}"
  unset PGPASSWORD
  case "${raw_url}" in
    postgresql://*|postgres://*) ;;
    *) printf 'error: a PostgreSQL URL is required\n' >&2; return 1 ;;
  esac

  scheme="${raw_url%%://*}"
  remainder="${raw_url#*://}"
  authority="${remainder%%/*}"
  path="${remainder#*/}"
  if [[ "${authority}" == *@* ]]; then
    userinfo="${authority%@*}"
    server="${authority##*@}"
    if [[ "${userinfo}" == *:* ]]; then
      encoded_password="${userinfo#*:}"
      decoded="${encoded_password//%/\\x}"
      printf -v PGPASSWORD '%b' "${decoded}"
      export PGPASSWORD
      userinfo="${userinfo%%:*}"
    fi
    OPENERP_PG_URL="${scheme}://${userinfo}@${server}/${path}"
  else
    OPENERP_PG_URL="${raw_url}"
  fi
  export OPENERP_PG_URL
}

openerp_pg_url_for_database() {
  local base_url="$1" database="$2" prefix query=""
  prefix="${base_url%%\?*}"
  if [[ "${base_url}" == *\?* ]]; then
    query="?${base_url#*\?}"
  fi
  printf '%s/%s%s' "${prefix%/*}" "${database}" "${query}"
}
