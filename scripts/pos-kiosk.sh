#!/usr/bin/env bash
#
# Abre el TPV en Chrome de forma que el ticket salga directo por la
# impresora predeterminada, sin el cuadro de impresión.
#
# Por qué hace falta este script: una página web **no puede** saltarse ese
# cuadro. `window.print()` siempre lo abre, y eso es una restricción de
# seguridad del navegador, no algo que se pueda programar desde la
# aplicación — si una web pudiera imprimir sola, cualquier página podría
# vaciarte el papel. La forma soportada de quitarlo es arrancar el propio
# navegador en modo caja, con `--kiosk-printing`: a partir de ahí,
# `window.print()` manda el trabajo a la impresora predeterminada y punto.
#
# Uso:
#   scripts/pos-kiosk.sh                      # http://localhost
#   scripts/pos-kiosk.sh https://tienda.local # otra dirección
#
# Antes de usarlo, en el equipo de la caja:
#   1. Poner la impresora de tickets como **predeterminada** del sistema.
#      Es la que usará: el modo caja no pregunta, y por eso no elige.
#   2. En su controlador, dejar puesto el ancho del rollo (58 u 80 mm).
#      Los márgenes los quita ya la propia aplicación.
#
# Para que arranque solo al encender la caja, añade este script a las
# aplicaciones de inicio de sesión del escritorio.

set -euo pipefail

URL="${1:-http://localhost}"

# El nombre del ejecutable cambia según cómo esté instalado Chrome.
for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
        CHROME="$candidate"
        break
    fi
done

if [[ -z "${CHROME:-}" ]]; then
    echo "No se ha encontrado Chrome ni Chromium en este equipo." >&2
    echo "Instala uno de los dos y vuelve a ejecutar este script." >&2
    exit 1
fi

# Perfil aparte: así el modo caja y sus ajustes de impresión no se mezclan
# con el navegador que se use para cualquier otra cosa.
PROFILE="${HOME}/.config/openerp-pos-kiosk"
mkdir -p "$PROFILE"

exec "$CHROME" \
    --kiosk-printing \
    --user-data-dir="$PROFILE" \
    --start-maximized \
    --app="${URL%/}/pos"
