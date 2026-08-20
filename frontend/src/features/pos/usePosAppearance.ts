import { useEffect } from 'react';

import { useShopSetting } from '@/features/settings/useShopSettings';

const DEFAULT_SURFACE = '#0f172a';
const DEFAULT_FONT_SIZE_PX = 18;

function safeColour(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_SURFACE;
}

/**
 * Aspecto propio de la caja. El tamaño se aplica en la raíz porque Tailwind
 * expresa sus tamaños táctiles en `rem`; así crecen de manera proporcionada
 * texto, botones y espacios de esta superficie, sin tener que mantener una
 * segunda escala CSS campo por campo.
 */
export function usePosAppearance(): { surfaceColor: string } {
  const surfaceColor = safeColour(useShopSetting('pos.surface_color', DEFAULT_SURFACE));
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

  return { surfaceColor };
}
