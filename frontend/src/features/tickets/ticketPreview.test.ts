import { describe, expect, it } from 'vitest';

import { renderTicketPreview } from './ticketPreview';

const BASE_FIELDS = {
  width_mm: 58 as const,
  header_text: '',
  footer_text: '',
  show_tax_breakdown: true,
  show_line_discounts: false,
};

describe('renderTicketPreview', () => {
  it('centres each non-blank header line and rules it off from the rest', () => {
    const preview = renderTicketPreview({ ...BASE_FIELDS, header_text: 'Mi Tienda\n\nGracias' });
    const lines = preview.split('\n');

    expect(lines[0]!.trim()).toBe('Mi Tienda');
    expect(lines[1]!.trim()).toBe('Gracias');
    expect(lines[2]).toBe('-'.repeat(32)); // 58mm -> 32 caracteres
  });

  it('omits the header rule entirely when there is no header text', () => {
    const preview = renderTicketPreview(BASE_FIELDS);
    expect(preview.startsWith('Venta #0001')).toBe(true);
  });

  it('widens to 48 characters for an 80mm template', () => {
    const preview = renderTicketPreview({ ...BASE_FIELDS, width_mm: 80, header_text: 'X' });
    expect(preview.split('\n')[1]).toBe('-'.repeat(48));
  });

  it('includes the tax breakdown lines only when requested', () => {
    const withBreakdown = renderTicketPreview({ ...BASE_FIELDS, show_tax_breakdown: true });
    const withoutBreakdown = renderTicketPreview({ ...BASE_FIELDS, show_tax_breakdown: false });

    expect(withBreakdown).toContain('Base imponible');
    expect(withoutBreakdown).not.toContain('Base imponible');
  });

  it('breaks the tax breakdown down by rate instead of a single total', () => {
    const preview = renderTicketPreview({ ...BASE_FIELDS, show_tax_breakdown: true });

    expect(preview).toContain('IVA 10%');
    expect(preview).toContain('IVA 21%');
  });

  it('includes a discount line only when requested', () => {
    const withDiscount = renderTicketPreview({ ...BASE_FIELDS, show_line_discounts: true });
    const withoutDiscount = renderTicketPreview({ ...BASE_FIELDS, show_line_discounts: false });

    expect(withDiscount).toContain('Dto. 10%');
    expect(withoutDiscount).not.toContain('Dto.');
  });

  it('centres the footer and rules it off from the rest, only when there is footer text', () => {
    const preview = renderTicketPreview({ ...BASE_FIELDS, footer_text: 'Vuelva pronto' });
    expect(preview).toContain('Vuelva pronto');

    const withoutFooter = renderTicketPreview(BASE_FIELDS);
    expect(withoutFooter).not.toContain('Vuelva pronto');
  });
});
