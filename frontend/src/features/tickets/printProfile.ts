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

/**
 * The PcCom POS-80 Windows preset is named `80(72)`: it consumes the physical
 * 4 mm at each side itself and exposes a 72 mm page to Chromium. Template side
 * margins are expressed against the complete 80 mm roll, so only the part
 * above those driver margins must enter `@page`.
 */
export const THERMAL_DRIVER_PRINTABLE_WIDTH_MM = 72;
const THERMAL_DRIVER_SIDE_MARGIN_MM =
  (THERMAL_PAPER_WIDTH_MM - THERMAL_DRIVER_PRINTABLE_WIDTH_MM) / 2;

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
 * The POS-80 driver has already removed its physical side margins before the
 * page reaches Chromium. Subtract that baseline and apply only any additional
 * margin requested by the template. Passing 4 + 4 mm again would leave a 64 mm
 * page and make Chromium scale the intended 72 mm ticket down to fit it.
 *
 * The driver still owns the paper format and continuous roll length. Setting a
 * fixed CSS page height here would split or pad receipts unnecessarily.
 */
export function ticketPageStyle(profile: TicketPrintProfile): string {
  const pageMarginLeft = Math.max(0, profile.margin_left_mm - THERMAL_DRIVER_SIDE_MARGIN_MM);
  const pageMarginRight = Math.max(0, profile.margin_right_mm - THERMAL_DRIVER_SIDE_MARGIN_MM);
  return `@media print { @page { margin: ${profile.margin_top_mm}mm ${pageMarginRight}mm ${profile.margin_bottom_mm}mm ${pageMarginLeft}mm; } }`;
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
