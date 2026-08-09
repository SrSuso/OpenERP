#!/usr/bin/env bash
#
# Generate a self-signed TLS certificate for the internal deployment
# (docker/compose.prod.yml's `web` service). Not for public internet use —
# it is trusted only by the machines you explicitly import it into (see
# docs/ADMIN_GUIDE.md, section "HTTPS interno").
#
# If your company already runs an internal CA, use that instead of this
# script: get a cert+key for your server's hostname/IP from it and drop
# them at deploy/certs/fullchain.pem and deploy/certs/privkey.pem — every
# machine on the domain already trusts that CA, so nobody has to import
# anything by hand.
#
#   scripts/gen-internal-cert.sh <hostname-or-ip> [more-hostnames-or-ips...]
#
# Example:
#   scripts/gen-internal-cert.sh openerp.miempresa.local 10.0.4.12
set -euo pipefail

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v openssl >/dev/null || die "openssl not found on PATH"
[[ $# -ge 1 ]] || die "usage: $0 <hostname-or-ip> [more-hostnames-or-ips...]"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/deploy/certs"
mkdir -p "${OUT_DIR}"

# Build the subjectAltName list: an IPv4-looking name goes in as IP:, an
# IPv6-looking name (contains ':') also as IP:, everything else as DNS:.
SAN=""
for name in "$@"; do
  if [[ "${name}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ || "${name}" == *:* ]]; then
    SAN+="IP:${name},"
  else
    SAN+="DNS:${name},"
  fi
done
SAN="${SAN%,}"

CN="$1"
KEY_FILE="${OUT_DIR}/privkey.pem"
CERT_FILE="${OUT_DIR}/fullchain.pem"

if [[ -f "${KEY_FILE}" || -f "${CERT_FILE}" ]]; then
  printf 'Ya existe un certificado en %s — se sobrescribirá.\nEscribe "yes" para continuar: ' "${OUT_DIR}"
  read -r reply
  [[ "${reply}" == "yes" ]] || die "aborted"
fi

log "generando certificado autofirmado para: ${SAN} (825 días)"
openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout "${KEY_FILE}" -out "${CERT_FILE}" \
  -subj "/CN=${CN}" \
  -addext "subjectAltName=${SAN}"

chmod 600 "${KEY_FILE}"
chmod 644 "${CERT_FILE}"

log "listo: ${CERT_FILE} / ${KEY_FILE}"
log "importa ${CERT_FILE} como autoridad de confianza en los equipos de la red interna (ver docs/ADMIN_GUIDE.md)"
