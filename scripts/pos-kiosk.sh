#!/usr/bin/env bash
#
# Abre el TPV en una ventana de Chrome separada y maximizada. Los tickets se
# imprimen mediante QZ Tray; este script no selecciona impresora ni interviene
# en la impresión.
#
# Uso:
#   scripts/pos-kiosk.sh                      # http://localhost
#   scripts/pos-kiosk.sh https://tienda.local # otra dirección
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

# Perfil aparte: así la ventana del TPV no se mezcla con el navegador que se
# use para cualquier otra cosa.
PROFILE="${HOME}/.config/openerp-pos-kiosk"
mkdir -p "$PROFILE"

exec "$CHROME" \
    --user-data-dir="$PROFILE" \
    --start-maximized \
    --app="${URL%/}/pos"
