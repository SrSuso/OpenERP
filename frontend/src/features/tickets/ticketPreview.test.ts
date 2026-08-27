import { describe, expect, it } from 'vitest';

import { renderTicketPreview } from './ticketPreview';

const BASE_FIELDS = {
  printable_width_mm: 48,
  font_size_px: 9,
  font_weight: 'NORMAL' as const,
  header_text: '',
  footer_text: '',
  tax_display: 'BREAKDOWN' as const,
  show_line_discounts: false,
  prices_include_tax: false,
  store_name: '',
  store_tax_id: '',
  store_address: '',
  store_phone: '',
  sale_number_prefix: 'Venta #',
  date_format: '%d/%m/%Y %H:%M',
  show_unit_price: true,
  show_cashier: false,
  label_total: 'TOTAL',
  label_change: 'Cambio',
  label_cash: 'Efectivo',
  label_card: 'Tarjeta',
  label_other: 'Otros',
  label_discount: 'Dto.',
  tax_note: 'IVA incluido',
  business_timezone: 'Europe/Madrid',
  now: new Date('2026-08-12T22:30:00Z'),
};

describe('renderTicketPreview', () => {
  it('centres each non-blank header line and rules it off from the rest', () => {
    const preview = renderTicketPreview({ ...BASE_FIELDS, header_text: 'Mi Tienda\n\nGracias' });
    const lines = preview.split('\n');

    expect(lines[0]!.trim()).toBe('Mi Tienda');
    expect(lines[1]!.trim()).toBe('Gracias');
    expect(lines[2]).toBe('-'.repeat(32)); // 48mm útiles -> 32 caracteres
  });

  it('omits the header rule entirely when there is no header text', () => {
    const preview = renderTicketPreview(BASE_FIELDS);
    expect(preview.startsWith('Venta #0001')).toBe(true);
  });

  it('shows the preview clock in the configured business timezone', () => {
    const madrid = renderTicketPreview(BASE_FIELDS);
    const utc = renderTicketPreview({ ...BASE_FIELDS, business_timezone: 'UTC' });

    expect(madrid).toContain('13/08/2026, 00:30');
    expect(utc).toContain('12/08/2026, 22:30');
  });

  it('widens to 48 characters for a 72mm printable area', () => {
    const preview = renderTicketPreview({
      ...BASE_FIELDS,
      printable_width_mm: 72,
      header_text: 'X',
    });
    expect(preview.split('\n')[1]).toBe('-'.repeat(48));
  });

  it('shows nothing about tax under NONE', () => {
    const preview = renderTicketPreview({ ...BASE_FIELDS, tax_display: 'NONE' });

    expect(preview).not.toContain('IVA');
    expect(preview).not.toContain('Cuota');
  });

  it('shows only the note under NOTE', () => {
    const preview = renderTicketPreview({ ...BASE_FIELDS, tax_display: 'NOTE' });

    expect(preview).toContain('IVA incluido');
    expect(preview).not.toContain('Cuota');
  });

  it('shows a row per rate with its base and quota under BREAKDOWN', () => {
    const preview = renderTicketPreview({ ...BASE_FIELDS, tax_display: 'BREAKDOWN' });
    const lines = preview.split('\n');

    expect(preview).toContain('Cuota');
    expect(lines.some((line) => line.startsWith('10%'))).toBe(true);
    expect(lines.some((line) => line.startsWith('21%'))).toBe(true);
  });

  it('extracts the tax from the price when the store says prices include it', () => {
    const added = renderTicketPreview({ ...BASE_FIELDS, prices_include_tax: false });
    const included = renderTicketPreview({ ...BASE_FIELDS, prices_include_tax: true });

    // Misma línea de 2 x 0,95 € al 10%: sumando IVA la base es 1,90 y el
    // total 2,09; con el IVA dentro, la base baja a 1,73 y el total es 1,90.
    expect(added.split('\n').find((line) => line.startsWith('10%'))).toContain('1,90 €');
    expect(included.split('\n').find((line) => line.startsWith('10%'))).toContain('1,73 €');
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
