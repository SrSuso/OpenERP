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
  it('turns configured 4 mm margins into visible blank bands inside the head', () => {
    expect(THERMAL_HARDWARE_GUTTER_MM).toBe(4);
    expect(ticketRasterGeometry(PROFILE, 2)).toMatchObject({
      widthDots: THERMAL_PRINTABLE_DOTS,
      contentLeftDots: 32,
      contentWidthDots: 512,
      lineHeightDots: 38,
    });
  });

  it('converts configured margins to raster pixels without widening text', () => {
    const geometry = ticketRasterGeometry(
      { ...PROFILE, printable_width_mm: 64, margin_left_mm: 6, margin_right_mm: 10 },
      2,
    );

    expect(geometry).toMatchObject({
      widthDots: 576,
      contentLeftDots: 48,
      contentWidthDots: 448,
    });
  });

  it('keeps spaces, accents and the euro sign in the exact preview document', () => {
    const svg = ticketRasterSvg('  CENTRADO  \nTOTAL      1.25 €\n', PROFILE);

    expect(svg).toContain('width="576"');
    expect(svg).toContain('xml:space="preserve">  CENTRADO  </text>');
    expect(svg).toContain('TOTAL      1.25 €');
  });

  it('clips text to the configured content area so the right margin remains blank', () => {
    const profile = { ...PROFILE, printable_width_mm: 64, margin_left_mm: 6, margin_right_mm: 10 };
    const svg = ticketRasterSvg('A line deliberately longer than the printable area', profile);

    expect(svg).toContain('<clipPath id="ticket-content">');
    expect(svg).toContain('<rect x="48" y="0" width="448"');
    expect(svg).toContain('clip-path="url(#ticket-content)"');
  });

  it('represents vertical margins as deterministic blank raster rows', () => {
    const geometry = ticketRasterGeometry({ ...PROFILE, margin_top_mm: 5, margin_bottom_mm: 7 }, 2);

    expect(geometry.topDots).toBe(40);
    expect(geometry.bottomDots).toBe(56);
    expect(geometry.heightDots).toBe(172);
  });
});
