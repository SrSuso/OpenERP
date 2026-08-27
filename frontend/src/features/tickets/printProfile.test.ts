import { describe, expect, it } from 'vitest';

import { ticketPageHeightMm, ticketPageStyle } from './printProfile';

const PROFILE = {
  printable_width_mm: 72,
  font_family: 'COURIER_NEW' as const,
  font_size_px: 9,
  line_height_px: 12,
  font_weight: 'NORMAL' as const,
  margin_top_mm: 2,
  margin_bottom_mm: 3,
};

describe('ticket print page profile', () => {
  it('uses the configured printable width for the physical print page', () => {
    expect(ticketPageStyle(PROFILE, 20)).toMatch(
      /^@page \{ size: 72mm \d+(?:\.\d+)?mm; margin: 0; \}$/,
    );
  });

  it('reserves configured margins and enough height for every printed line', () => {
    expect(ticketPageHeightMm(PROFILE, 20)).toBeGreaterThan(ticketPageHeightMm(PROFILE, 5));
    expect(ticketPageHeightMm(PROFILE, 1)).toBeGreaterThanOrEqual(25);
  });
});
