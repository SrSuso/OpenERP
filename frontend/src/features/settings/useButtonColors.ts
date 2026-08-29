import { useEffect } from 'react';

import { useShopSetting } from '@/features/settings/useShopSettings';
import { hexToOklch, oklchString } from '@/lib/oklch';

/** Los colores de fábrica, los mismos que hay escritos en `index.css`: azul
 * para el panel, verde para las acciones de la caja. */
const DEFAULT_PANEL = '#2b5bb5';
const DEFAULT_TILL = '#059669';
const DEFAULT_POS_SECONDARY = '#334155';
const DEFAULT_POS_DANGER = '#b91c1c';

/** Cada tono de la escala, con su claridad y su saturación fijas.
 *
 * Del color elegido se toma **sólo el tono**, y el resto de la escala se
 * reconstruye con estos valores. Es lo que hace que se pueda elegir
 * cualquier color sin quedarse con un botón ilegible: un amarillo claro
 * puesto tal cual daría letra blanca sobre amarillo, mientras que así el
 * amarillo se oscurece hasta la claridad que ya tenía el azul de fábrica,
 * que es la que se diseñó para que el texto encima se lea. */
const PANEL_RAMP: Record<string, { l: number; c: number }> = {
  '--color-brand-50': { l: 0.97, c: 0.02 },
  '--color-brand-100': { l: 0.93, c: 0.05 },
  '--color-brand-200': { l: 0.88, c: 0.07 },
  '--color-brand-500': { l: 0.58, c: 0.16 },
  '--color-brand-600': { l: 0.51, c: 0.16 },
  '--color-brand-700': { l: 0.44, c: 0.14 },
};

const TILL_RAMP: Record<string, { l: number; c: number }> = {
  '--color-till-500': { l: 0.7, c: 0.17 },
  '--color-till-600': { l: 0.6, c: 0.145 },
};

/** Los botones normales no pueden seguir heredando gris de Tailwind: su
 * tono también es una decisión de la tienda. Los dos tonos permiten que el
 * hover siga siendo perceptible sin cambiar el color elegido por otro. */
const POS_SECONDARY_RAMP: Record<string, { l: number; c: number }> = {
  '--color-pos-secondary-500': { l: 0.45, c: 0.05 },
  '--color-pos-secondary-600': { l: 0.37, c: 0.045 },
};

/** Anular una venta debe seguir distinguiéndose incluso aunque se cambien
 * todos los demás colores de la caja. */
const POS_DANGER_RAMP: Record<string, { l: number; c: number }> = {
  '--color-pos-danger-500': { l: 0.56, c: 0.19 },
  '--color-pos-danger-600': { l: 0.49, c: 0.17 },
};

function applyRamp(
  ramp: Record<string, { l: number; c: number }>,
  hex: string,
  fallback: string,
): void {
  const chosen = hexToOklch(hex) ?? hexToOklch(fallback)!;
  for (const [variable, { l, c }] of Object.entries(ramp)) {
    // La saturación se limita a la del color elegido: un gris pedido a
    // propósito tiene que salir gris, no gris teñido.
    document.documentElement.style.setProperty(
      variable,
      oklchString({ l, c: Math.min(c, chosen.c), h: chosen.h }),
    );
  }
}

/**
 * Aplica los colores de botón elegidos en Configuración y, para la caja,
 * en Terminales POS.
 *
 * Igual que el tamaño de letra: se cambian las variables de color en la
 * raíz, así que valen a la vez para todos los botones sin tocar ni una
 * pantalla. Se limpian al desmontar, para que la pantalla de entrada —que
 * se pinta sin sesión— no se quede con los colores de la tienda pegados.
 */
export function useButtonColors(): void {
  const panel = useShopSetting('ui.button_color', DEFAULT_PANEL);
  const till = useShopSetting('ui.pos_button_color', DEFAULT_TILL);
  const posSecondary = useShopSetting('ui.pos_secondary_button_color', DEFAULT_POS_SECONDARY);
  const posDanger = useShopSetting('ui.pos_danger_button_color', DEFAULT_POS_DANGER);

  useEffect(() => {
    applyRamp(PANEL_RAMP, panel, DEFAULT_PANEL);
    applyRamp(TILL_RAMP, till, DEFAULT_TILL);
    applyRamp(POS_SECONDARY_RAMP, posSecondary, DEFAULT_POS_SECONDARY);
    applyRamp(POS_DANGER_RAMP, posDanger, DEFAULT_POS_DANGER);
    return () => {
      for (const variable of [
        ...Object.keys(PANEL_RAMP),
        ...Object.keys(TILL_RAMP),
        ...Object.keys(POS_SECONDARY_RAMP),
        ...Object.keys(POS_DANGER_RAMP),
      ]) {
        document.documentElement.style.removeProperty(variable);
      }
    };
  }, [panel, till, posSecondary, posDanger]);
}
