import { describe, expect, it } from 'vitest';

import {
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
  it('uses the 80 mm thermal roll while keeping the configured width for content', () => {
    expect(ticketPageStyle(PROFILE, 20)).toMatch(
      /^@page \{ size: 80mm \d+(?:\.\d+)?mm; margin: 0; \}$/,
    );
    expect(ticketPreviewStyle(PROFILE)).toMatchObject({
      width: '72mm',
      marginLeft: '4mm',
      marginRight: '4mm',
    });
    expect(ticketPrintStyle(PROFILE)).toMatchObject({
      '--ticket-margin-left': '4mm',
      '--ticket-margin-right': '4mm',
    });
  });

  it('reserves configured margins and enough height for every printed line', () => {
    expect(ticketPageHeightMm(PROFILE, 20)).toBeGreaterThan(ticketPageHeightMm(PROFILE, 5));
    expect(ticketPageHeightMm(PROFILE, 1)).toBeGreaterThanOrEqual(25);
  });
});
