import { useEffect } from 'react';

import { useShopSetting } from '@/features/settings/useShopSettings';

/** Lo que trae el navegador de fábrica, y lo que valen los tamaños de
 * Tailwind si no se toca nada. */
const BROWSER_DEFAULT_PX = 16;

/**
 * Aplica el tamaño de letra elegido en Configuración → Pantalla a toda la
 * aplicación.
 *
 * Se hace en la raíz del documento, no repartido por las pantallas, porque
 * los tamaños de Tailwind van en `rem`: cambiando el de la raíz crecen a la
 * vez las letras, el alto de los botones, el aire de las filas y el ancho
 * de los recuadros. Subirlo campo a campo habría dejado una pantalla
 * grande y la de al lado no.
 *
 * Se limpia al desmontar para no dejarle el tamaño pegado a la pantalla de
 * entrada, que se pinta sin sesión y por tanto sin poder leer el ajuste.
 */
export function useBaseFontSize(): void {
  const px = Number(useShopSetting('ui.base_font_px', String(BROWSER_DEFAULT_PX)));

  useEffect(() => {
    // Un valor absurdo (o un ajuste que no se ha podido leer) no puede
    // dejar la aplicación ilegible: se vuelve al de siempre.
    const size = Number.isFinite(px) && px >= 10 && px <= 40 ? px : BROWSER_DEFAULT_PX;
    document.documentElement.style.fontSize = `${size}px`;
    return () => {
      document.documentElement.style.fontSize = '';
    };
  }, [px]);
}
