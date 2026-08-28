import { type CSSProperties } from 'react';

import { type TicketFontFamily, type TicketFontWeight } from '@/features/tickets/api';

export interface TicketPrintProfile {
  printable_width_mm: number;
  margin_left_mm: number;
  margin_right_mm: number;
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
    '--ticket-margin-left': `${profile.margin_left_mm}mm`,
    '--ticket-margin-right': `${profile.margin_right_mm}mm`,
    '--ticket-font-family': FONT_STACKS[profile.font_family],
    '--ticket-font-size': `${profile.font_size_px}px`,
    '--ticket-line-height': `${profile.line_height_px}px`,
    '--ticket-font-weight': profile.font_weight === 'BOLD' ? '700' : '400',
    '--ticket-margin-top': `${profile.margin_top_mm}mm`,
    '--ticket-margin-bottom': `${profile.margin_bottom_mm}mm`,
  } as CSSProperties;
}

/**
 * Physical margins belong to the printer page, not to an 80 mm element inside
 * that page. Thermal drivers already expose a printable area smaller than the
 * roll; applying the same margins to an 80 mm element makes Chromium shrink
 * the whole ticket a second time. A per-document rule lets the browser
 * reconcile the requested margins with the driver's non-printable area.
 *
 * The driver still owns the paper format and continuous roll length. Setting a
 * fixed CSS page height here would split or pad receipts unnecessarily.
 */
export function ticketPageStyle(profile: TicketPrintProfile): string {
  return `@media print { @page { margin: ${profile.margin_top_mm}mm ${profile.margin_right_mm}mm ${profile.margin_bottom_mm}mm ${profile.margin_left_mm}mm; } }`;
}

/** The editor preview uses the same safe font settings before print CSS applies. */
export function ticketPreviewStyle(profile: TicketPrintProfile): CSSProperties {
  return {
    width: `${profile.printable_width_mm}mm`,
    maxWidth: '100%',
    boxSizing: 'border-box',
    marginTop: `${profile.margin_top_mm}mm`,
    marginBottom: `${profile.margin_bottom_mm}mm`,
    marginLeft: `${profile.margin_left_mm}mm`,
    marginRight: `${profile.margin_right_mm}mm`,
    fontFamily: FONT_STACKS[profile.font_family],
    fontSize: `${profile.font_size_px}px`,
    fontWeight: profile.font_weight === 'BOLD' ? 700 : 400,
    lineHeight: `${profile.line_height_px}px`,
  };
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
