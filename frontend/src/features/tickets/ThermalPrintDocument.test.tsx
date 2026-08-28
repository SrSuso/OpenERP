import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ThermalPrintDocument } from './ThermalPrintDocument';

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

describe('ThermalPrintDocument', () => {
  it('mounts one isolated document with the complete physical profile', () => {
    const view = render(
      <ThermalPrintDocument active text={'LINEA 1\nLINEA 2'} profile={PROFILE} />,
    );
    const printRoot = document.querySelector<HTMLElement>(
      ".ticket-print-root[data-print-active='true']",
    );

    expect(printRoot?.parentElement).toBe(document.body);
    expect(printRoot).toHaveAttribute('data-ticket-width', '72');
    expect(printRoot?.style.getPropertyValue('--ticket-printable-width')).toBe('72mm');
    expect(printRoot?.style.getPropertyValue('--ticket-margin-left')).toBe('4mm');
    expect(printRoot?.style.getPropertyValue('--ticket-margin-right')).toBe('4mm');
    expect(printRoot?.querySelector('[data-ticket-page-style]')).toHaveTextContent(
      '@page { margin: 2mm 0mm 3mm 0mm; }',
    );
    expect(document.body).toHaveClass('printing-thermal-document');

    view.rerender(<ThermalPrintDocument active={false} text="" profile={PROFILE} />);
    expect(document.querySelector('.ticket-print-root')).toBeNull();
    expect(document.body).not.toHaveClass('printing-thermal-document');
  });
});
