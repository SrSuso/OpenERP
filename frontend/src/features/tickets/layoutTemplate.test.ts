import { describe, expect, it } from 'vitest';

import {
  TicketLayoutTemplateError,
  renderTicketLayoutTemplate,
  ticketLayoutPreviewContext,
} from './layoutTemplate';

const VALUES = {
  store_name: 'Comercial Barbosa',
  store_tax_id: 'B123',
  store_address: 'Calle 1',
  store_phone: '900 000 000',
  header_text: '',
  footer_text: 'Gracias',
  label_total: 'TOTAL',
  label_change: 'Cambio',
  label_cash: 'Efectivo',
  label_card: 'Tarjeta',
  label_other: 'Otros',
  tax_note: 'IVA incluido',
};

describe('ticket layout preview', () => {
  it('renders receipt variables and a line loop without horizontal overflow', () => {
    const source = `{% for line in sale.lines %}{{ line.name | left:14 }}{{ line.total | right:6 }}\n{% endfor %}{{ labels.total | left:14 }}{{ totals.total | right:6 }}`;

    const preview = renderTicketLayoutTemplate(source, ticketLayoutPreviewContext(VALUES, 20), 20);

    expect(preview).toContain('Agua mineral');
    expect(preview).toContain('TOTAL           1.90');
    expect(preview.split('\n').every((line) => line.length <= 20)).toBe(true);
  });

  it('rejects arbitrary code and unsupported blocks before previewing', () => {
    expect(() =>
      renderTicketLayoutTemplate('{{ window.alert }}', ticketLayoutPreviewContext(VALUES, 20), 20),
    ).toThrow(TicketLayoutTemplateError);
    expect(() =>
      renderTicketLayoutTemplate(
        '{% if sale.number %}x{% endif %}',
        ticketLayoutPreviewContext(VALUES, 20),
        20,
      ),
    ).toThrow(TicketLayoutTemplateError);
  });
});
