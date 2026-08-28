import { describe, expect, it } from 'vitest';

import {
  printableCharacters,
  THERMAL_DRIVER_PRINTABLE_WIDTH_MM,
  THERMAL_PAPER_WIDTH_MM,
  ticketPageStyle,
  ticketPreviewStyle,
  ticketPrintStyle,
} from './printProfile';

const PROFILE = {
  printable_width_mm: 72,
  margin_left_mm: 4,
  margin_right_mm: 4,
  font_family: 'COURIER_NEW' as const,
  font_size_px: 9,
  line_height_px: 12,
  font_weight: 'NORMAL' as const,
  margin_top_mm: 2,
  margin_bottom_mm: 3,
};

describe('ticket print page profile', () => {
  it('keeps the configured printable area and margins inside the 80 mm roll', () => {
    expect(THERMAL_PAPER_WIDTH_MM).toBe(80);
    expect(THERMAL_DRIVER_PRINTABLE_WIDTH_MM).toBe(72);
    expect(ticketPreviewStyle(PROFILE)).toMatchObject({
      width: '72mm',
      marginLeft: '4mm',
      marginRight: '4mm',
    });
    expect(ticketPrintStyle(PROFILE)).toMatchObject({
      '--ticket-margin-left': '4mm',
      '--ticket-margin-right': '4mm',
    });
    expect(ticketPageStyle(PROFILE)).toBe('@media print { @page { margin: 2mm 0mm 3mm 0mm; } }');
  });

  it('adds only template margins beyond the four millimetres already owned by POS-80', () => {
    expect(
      ticketPageStyle({
        ...PROFILE,
        printable_width_mm: 60,
        margin_left_mm: 10,
        margin_right_mm: 10,
      }),
    ).toBe('@media print { @page { margin: 2mm 6mm 3mm 6mm; } }');
  });

  it('calculates a conservative line width without imposing a roll height', () => {
    expect(printableCharacters(PROFILE)).toBe(48);
  });
});
