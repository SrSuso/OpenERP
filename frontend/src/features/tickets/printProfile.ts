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
 * Define the same physical page LibreOffice sends successfully to POS-80:
 * an explicit 80 mm sheet with the template margins inside it. The height is
 * calculated from the receipt instead of using a fixed 200 mm sheet, so the
 * thermal driver can cut immediately after the content without blank feed.
 */
export function ticketPageHeightMm(
  profile: Pick<TicketPrintProfile, 'line_height_px' | 'margin_top_mm' | 'margin_bottom_mm'>,
  lineCount: number,
): number {
  const lineHeightMm = (profile.line_height_px * 25.4) / 96;
  const contentHeight =
    profile.margin_top_mm + Math.max(1, lineCount) * lineHeightMm + profile.margin_bottom_mm;
  return Math.max(25, Math.ceil((contentHeight + 4) * 10) / 10);
}

export function ticketPageStyle(profile: TicketPrintProfile, lineCount: number): string {
  const height = ticketPageHeightMm(profile, lineCount);
  return `@media print { @page { size: ${THERMAL_PAPER_WIDTH_MM}mm ${height}mm; margin: ${profile.margin_top_mm}mm ${profile.margin_right_mm}mm ${profile.margin_bottom_mm}mm ${profile.margin_left_mm}mm; } }`;
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
  // All supported monospace stacks retain their advance in bold. Their real
  // value is about 0.60 em; 0.61 keeps a small no-wrap safety margin without
  // throwing away a complete column.
  const characterWidthEm = 0.61;
  return Math.max(
    16,
    Math.floor(
      profile.printable_width_mm / ((profile.font_size_px * characterWidthEm * 25.4) / 96),
    ),
  );
}
