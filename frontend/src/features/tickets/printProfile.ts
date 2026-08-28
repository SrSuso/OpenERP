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

export function ticketFontStack(font: TicketFontFamily): string {
  return FONT_STACKS[font];
}

/**
 * La instalación usa bobina térmica estándar de 80 mm. `printable_width_mm`
 * es deliberadamente otra cosa: la zona útil del contenido, que puede ser
 * menor para respetar los márgenes no imprimibles del cabezal.
 */
export const THERMAL_PAPER_WIDTH_MM = 80;

/**
 * Same model as LibreOffice's page dialog: the roll width is fixed and the
 * content area is whatever remains between the physical side margins. Keeping
 * this calculation in one place prevents the editor from treating width as a
 * third, independent scaling control.
 */
export function printableWidthFromMargins(leftMm: number, rightMm: number): number {
  return THERMAL_PAPER_WIDTH_MM - leftMm - rightMm;
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
