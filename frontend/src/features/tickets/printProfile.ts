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
