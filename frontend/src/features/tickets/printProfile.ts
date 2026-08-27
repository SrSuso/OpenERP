import { type CSSProperties } from 'react';

import { type TicketFontFamily, type TicketFontWeight } from '@/features/tickets/api';

export interface TicketPrintProfile {
  printable_width_mm: number;
  font_family: TicketFontFamily;
  font_size_px: number;
  line_height_px: number;
  font_weight: TicketFontWeight;
  margin_top_mm: number;
  margin_bottom_mm: number;
}

const FONT_STACKS: Record<TicketFontFamily, string> = {
  COURIER_NEW: "'Courier New', 'Liberation Mono', monospace",
  LIBERATION_MONO: "'Liberation Mono', 'Courier New', monospace",
  DEJAVU_SANS_MONO: "'DejaVu Sans Mono', 'Liberation Mono', monospace",
};

/**
 * La instalación usa bobina térmica estándar de 80 mm. `printable_width_mm`
 * es deliberadamente otra cosa: la zona útil del contenido, que puede ser
 * menor para respetar los márgenes no imprimibles del cabezal.
 */
export const THERMAL_PAPER_WIDTH_MM = 80;

/** Known values only: a template cannot inject arbitrary CSS into printing. */
export function ticketPrintStyle(profile: TicketPrintProfile): CSSProperties {
  return {
    '--ticket-printable-width': `${profile.printable_width_mm}mm`,
    '--ticket-font-family': FONT_STACKS[profile.font_family],
    '--ticket-font-size': `${profile.font_size_px}px`,
    '--ticket-line-height': `${profile.line_height_px}px`,
    '--ticket-font-weight': profile.font_weight === 'BOLD' ? '700' : '400',
    '--ticket-margin-top': `${profile.margin_top_mm}mm`,
    '--ticket-margin-bottom': `${profile.margin_bottom_mm}mm`,
  } as CSSProperties;
}

/** The editor preview uses the same safe font settings before print CSS applies. */
export function ticketPreviewStyle(profile: TicketPrintProfile): CSSProperties {
  return {
    width: `${profile.printable_width_mm}mm`,
    maxWidth: '100%',
    boxSizing: 'border-box',
    marginTop: `${profile.margin_top_mm}mm`,
    marginBottom: `${profile.margin_bottom_mm}mm`,
    fontFamily: FONT_STACKS[profile.font_family],
    fontSize: `${profile.font_size_px}px`,
    fontWeight: profile.font_weight === 'BOLD' ? 700 : 400,
    lineHeight: `${profile.line_height_px}px`,
  };
}

/**
 * El tamaño de página no puede leer las custom properties CSS de un ticket.
 * Por eso generamos una regla literal y segura para el único documento que se
 * está imprimiendo. El alto deja espacio exacto para sus líneas, los márgenes
 * configurados y una pequeña tolerancia del cabezal térmico; evita que un
 * navegador lo reparta por defecto en hojas A4.
 */
export function ticketPageHeightMm(
  profile: Pick<TicketPrintProfile, 'line_height_px' | 'margin_top_mm' | 'margin_bottom_mm'>,
  lineCount: number,
): number {
  const lineHeightMm = (profile.line_height_px * 25.4) / 96;
  const safeLineCount = Math.max(1, lineCount);
  return Math.max(
    25,
    Math.ceil(
      (profile.margin_top_mm + safeLineCount * lineHeightMm + profile.margin_bottom_mm + 4) * 10,
    ) / 10,
  );
}

export function ticketPageStyle(profile: TicketPrintProfile, lineCount: number): string {
  return `@page { size: ${THERMAL_PAPER_WIDTH_MM}mm ${ticketPageHeightMm(profile, lineCount)}mm; margin: 0; }`;
}

/** Same conservative capacity model as backend/app/tickets/render.py. */
export function printableCharacters(
  profile: Pick<TicketPrintProfile, 'printable_width_mm' | 'font_size_px' | 'font_weight'>,
): number {
  const characterWidthEm = profile.font_weight === 'BOLD' ? 0.65 : 0.62;
  return Math.max(
    16,
    Math.floor(
      profile.printable_width_mm / ((profile.font_size_px * characterWidthEm * 25.4) / 96),
    ),
  );
}
