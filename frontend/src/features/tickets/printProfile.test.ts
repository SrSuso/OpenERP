import { describe, expect, it } from 'vitest';

import {
  printableCharacters,
  printableWidthFromMargins,
  THERMAL_PAPER_WIDTH_MM,
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
    expect(printableWidthFromMargins(PROFILE.margin_left_mm, PROFILE.margin_right_mm)).toBe(72);
  });

  it('keeps wider template margins inside the explicit 80mm page', () => {
    expect(printableWidthFromMargins(10, 10)).toBe(60);
  });

  it('calculates a conservative line width without imposing a roll height', () => {
    expect(printableCharacters(PROFILE)).toBe(49);
  });
});
