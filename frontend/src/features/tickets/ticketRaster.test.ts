import { describe, expect, it } from 'vitest';

import {
  THERMAL_HARDWARE_GUTTER_MM,
  THERMAL_PRINTABLE_DOTS,
  ticketRasterGeometry,
  ticketRasterSvg,
} from './ticketRaster';

const PROFILE = {
  printable_width_mm: 72,
  margin_left_mm: 4,
  margin_right_mm: 4,
  font_family: 'COURIER_NEW' as const,
  font_size_px: 12,
  line_height_px: 20,
  font_weight: 'NORMAL' as const,
  margin_top_mm: 0,
  margin_bottom_mm: 0,
};

describe('POS-80 ticket raster', () => {
  it('uses the complete 576-dot head for physical 4 mm paper gutters', () => {
    expect(THERMAL_HARDWARE_GUTTER_MM).toBe(4);
    expect(ticketRasterGeometry(PROFILE, 2)).toMatchObject({
      widthDots: THERMAL_PRINTABLE_DOTS,
      contentLeftDots: 0,
      contentWidthDots: 576,
      lineHeightDots: 42,
    });
  });

  it('converts margins beyond the hardware gutter to raster pixels without scaling text', () => {
    const geometry = ticketRasterGeometry(
      { ...PROFILE, printable_width_mm: 64, margin_left_mm: 6, margin_right_mm: 10 },
      2,
    );

    expect(geometry).toMatchObject({
      widthDots: 576,
      contentLeftDots: 16,
      contentWidthDots: 512,
      fontSizeDots: ticketRasterGeometry(PROFILE, 2).fontSizeDots,
    });
  });

  it('keeps spaces, accents and the euro sign in the exact preview document', () => {
    const svg = ticketRasterSvg('  CENTRADO  \nTOTAL      1.25 €\n', PROFILE);

    expect(svg).toContain('width="576"');
    expect(svg).toContain('xml:space="preserve">  CENTRADO  </text>');
    expect(svg).toContain('TOTAL      1.25 €');
  });
});
