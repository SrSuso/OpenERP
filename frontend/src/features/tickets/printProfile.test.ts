import { describe, expect, it } from 'vitest';

import {
  printableCharacters,
  THERMAL_PAPER_WIDTH_MM,
  ticketPageHeightMm,
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
    expect(ticketPreviewStyle(PROFILE)).toMatchObject({
      width: '72mm',
      marginLeft: '4mm',
      marginRight: '4mm',
    });
    expect(ticketPrintStyle(PROFILE)).toMatchObject({
      '--ticket-margin-left': '4mm',
      '--ticket-margin-right': '4mm',
    });
    expect(ticketPageHeightMm(PROFILE, 20)).toBe(72.5);
    expect(ticketPageStyle(PROFILE, 20)).toBe(
      '@media print { @page { size: 80mm 72.5mm; margin: 2mm 4mm 3mm 4mm; } }',
    );
  });

  it('keeps wider template margins inside the explicit 80mm page', () => {
    expect(
      ticketPageStyle(
        {
          ...PROFILE,
          printable_width_mm: 60,
          margin_left_mm: 10,
          margin_right_mm: 10,
        },
        20,
      ),
    ).toBe('@media print { @page { size: 80mm 72.5mm; margin: 2mm 10mm 3mm 10mm; } }');
  });

  it('calculates a conservative line width without imposing a roll height', () => {
    expect(printableCharacters(PROFILE)).toBe(49);
  });
});
