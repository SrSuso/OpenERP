import { useEffect } from 'react';

import { useShopSetting } from '@/features/settings/useShopSettings';
import { hexToOklch, oklchString } from '@/lib/oklch';

/** Los colores de fábrica, los mismos que hay escritos en `index.css`: azul
 * para el panel, verde para las acciones de la caja. */
const DEFAULT_PANEL = '#2b5bb5';
const DEFAULT_TILL = '#059669';
const DEFAULT_TILL_HOVER = '#10b981';
const DEFAULT_TILL_TEXT = '#ffffff';
const DEFAULT_POS_SECONDARY = '#334155';
const DEFAULT_POS_SECONDARY_HOVER = '#475569';
const DEFAULT_POS_SECONDARY_TEXT = '#f8fafc';
const DEFAULT_POS_DANGER = '#b91c1c';
const DEFAULT_POS_DANGER_HOVER = '#dc2626';
const DEFAULT_POS_DANGER_TEXT = '#ffffff';

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

/** Los colores del TPV son literales: negro tiene que seguir siendo negro.
 * El único trabajo defensivo es sustituir una cadena inválida por el valor
 * de fábrica, nunca modificar brillo, saturación ni contraste. */
function exactColour(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function applyExactButtonColours(
  variables: { background: string; hover: string; text: string },
  values: { background: string; hover: string; text: string },
  fallbacks: { background: string; hover: string; text: string },
): void {
  document.documentElement.style.setProperty(
    variables.background,
    exactColour(values.background, fallbacks.background),
  );
  document.documentElement.style.setProperty(
    variables.hover,
    exactColour(values.hover, fallbacks.hover),
  );
  document.documentElement.style.setProperty(
    variables.text,
    exactColour(values.text, fallbacks.text),
  );
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
  const tillHover = useShopSetting('ui.pos_button_hover_color', DEFAULT_TILL_HOVER);
  const tillText = useShopSetting('ui.pos_button_text_color', DEFAULT_TILL_TEXT);
  const posSecondary = useShopSetting('ui.pos_secondary_button_color', DEFAULT_POS_SECONDARY);
  const posSecondaryHover = useShopSetting(
    'ui.pos_secondary_button_hover_color',
    DEFAULT_POS_SECONDARY_HOVER,
  );
  const posSecondaryText = useShopSetting(
    'ui.pos_secondary_button_text_color',
    DEFAULT_POS_SECONDARY_TEXT,
  );
  const posDanger = useShopSetting('ui.pos_danger_button_color', DEFAULT_POS_DANGER);
  const posDangerHover = useShopSetting(
    'ui.pos_danger_button_hover_color',
    DEFAULT_POS_DANGER_HOVER,
  );
  const posDangerText = useShopSetting('ui.pos_danger_button_text_color', DEFAULT_POS_DANGER_TEXT);

  useEffect(() => {
    applyRamp(PANEL_RAMP, panel, DEFAULT_PANEL);
    applyExactButtonColours(
      { background: '--color-till-600', hover: '--color-till-500', text: '--color-till-text' },
      { background: till, hover: tillHover, text: tillText },
      { background: DEFAULT_TILL, hover: DEFAULT_TILL_HOVER, text: DEFAULT_TILL_TEXT },
    );
    applyExactButtonColours(
      {
        background: '--color-pos-secondary-600',
        hover: '--color-pos-secondary-500',
        text: '--color-pos-secondary-text',
      },
      { background: posSecondary, hover: posSecondaryHover, text: posSecondaryText },
      {
        background: DEFAULT_POS_SECONDARY,
        hover: DEFAULT_POS_SECONDARY_HOVER,
        text: DEFAULT_POS_SECONDARY_TEXT,
      },
    );
    applyExactButtonColours(
      {
        background: '--color-pos-danger-600',
        hover: '--color-pos-danger-500',
        text: '--color-pos-danger-text',
      },
      { background: posDanger, hover: posDangerHover, text: posDangerText },
      {
        background: DEFAULT_POS_DANGER,
        hover: DEFAULT_POS_DANGER_HOVER,
        text: DEFAULT_POS_DANGER_TEXT,
      },
    );
    return () => {
      for (const variable of [
        ...Object.keys(PANEL_RAMP),
        '--color-till-600',
        '--color-till-500',
        '--color-till-text',
        '--color-pos-secondary-600',
        '--color-pos-secondary-500',
        '--color-pos-secondary-text',
        '--color-pos-danger-600',
        '--color-pos-danger-500',
        '--color-pos-danger-text',
      ]) {
        document.documentElement.style.removeProperty(variable);
      }
    };
  }, [
    panel,
    till,
    tillHover,
    tillText,
    posSecondary,
    posSecondaryHover,
    posSecondaryText,
    posDanger,
    posDangerHover,
    posDangerText,
  ]);
}
