import { useEffect } from 'react';

import { useShopSetting } from '@/features/settings/useShopSettings';

const DEFAULT_SURFACE = '#0f172a';
const DEFAULT_PANEL = '#1e293b';
const DEFAULT_BORDER = '#475569';
const DEFAULT_TEXT = '#f8fafc';
const DEFAULT_MUTED_TEXT = '#cbd5e1';
const DEFAULT_AMOUNT = '#34d399';
const DEFAULT_INPUT_BACKGROUND = '#0f172a';
const DEFAULT_INPUT_TEXT = '#f8fafc';
const DEFAULT_FONT_SIZE_PX = 18;

function safeColour(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

/**
 * Aspecto propio de la caja. El tamaño se aplica en la raíz porque Tailwind
 * expresa sus tamaños táctiles en `rem`; así crecen de manera proporcionada
 * texto, botones y espacios de esta superficie, sin tener que mantener una
 * segunda escala CSS campo por campo.
 */
export function usePosAppearance(): { surfaceColor: string } {
  const surfaceColor = safeColour(
    useShopSetting('pos.surface_color', DEFAULT_SURFACE),
    DEFAULT_SURFACE,
  );
  const panelColor = safeColour(useShopSetting('pos.panel_color', DEFAULT_PANEL), DEFAULT_PANEL);
  const borderColor = safeColour(
    useShopSetting('pos.border_color', DEFAULT_BORDER),
    DEFAULT_BORDER,
  );
  const textColor = safeColour(useShopSetting('pos.text_color', DEFAULT_TEXT), DEFAULT_TEXT);
  const mutedTextColor = safeColour(
    useShopSetting('pos.muted_text_color', DEFAULT_MUTED_TEXT),
    DEFAULT_MUTED_TEXT,
  );
  const amountColor = safeColour(
    useShopSetting('pos.amount_color', DEFAULT_AMOUNT),
    DEFAULT_AMOUNT,
  );
  const inputBackgroundColor = safeColour(
    useShopSetting('pos.input_background_color', DEFAULT_INPUT_BACKGROUND),
    DEFAULT_INPUT_BACKGROUND,
  );
  const inputTextColor = safeColour(
    useShopSetting('pos.input_text_color', DEFAULT_INPUT_TEXT),
    DEFAULT_INPUT_TEXT,
  );
  const configuredSize = Number(useShopSetting('pos.font_size_px', String(DEFAULT_FONT_SIZE_PX)));

  useEffect(() => {
    const size =
      Number.isFinite(configuredSize) && configuredSize >= 14 && configuredSize <= 28
        ? configuredSize
        : DEFAULT_FONT_SIZE_PX;
    const previous = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = `${size}px`;
    return () => {
      document.documentElement.style.fontSize = previous;
    };
  }, [configuredSize]);

  useEffect(() => {
    const variables: Record<string, string> = {
      '--pos-surface-color': surfaceColor,
      '--pos-panel-color': panelColor,
      '--pos-border-color': borderColor,
      '--pos-text-color': textColor,
      '--pos-muted-text-color': mutedTextColor,
      '--pos-amount-color': amountColor,
      '--pos-input-background-color': inputBackgroundColor,
      '--pos-input-text-color': inputTextColor,
    };
    for (const [variable, value] of Object.entries(variables)) {
      document.documentElement.style.setProperty(variable, value);
    }
    return () => {
      for (const variable of Object.keys(variables)) {
        document.documentElement.style.removeProperty(variable);
      }
    };
  }, [
    surfaceColor,
    panelColor,
    borderColor,
    textColor,
    mutedTextColor,
    amountColor,
    inputBackgroundColor,
    inputTextColor,
  ]);

  return { surfaceColor };
}
