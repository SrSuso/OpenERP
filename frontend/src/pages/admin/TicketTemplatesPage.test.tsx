import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type TicketTemplate } from '@/features/tickets/api';

import { TicketTemplatesPage } from './TicketTemplatesPage';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const ME = {
  id: 1,
  email: 'admin@example.com',
  full_name: 'Admin Uno',
  role: 'ADMIN',
  permissions: ['admin.access', 'ticket.manage'],
};

const PRINT_PROFILE = {
  printable_width_mm: 72,
  font_family: 'COURIER_NEW' as const,
  font_size_px: 9,
  line_height_px: 12,
  font_weight: 'NORMAL' as const,
  margin_top_mm: 0,
  margin_bottom_mm: 0,
  layout_template: '',
};

function stubBackend() {
  let templates: TicketTemplate[] = [];
  const createCalls: Record<string, unknown>[] = [];
  const updateCalls: { id: number; body: Record<string, unknown> }[] = [];
  const deleteCalls: number[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = () =>
        init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (method === 'GET' && url.includes('/pricing/settings')) {
        return Promise.resolve(jsonResponse({ formula: 'cost', prices_include_tax: false }));
      }
      if (method === 'GET' && /\/ticket-templates\/active$/.test(url)) {
        const active = templates.find((t) => t.is_active);
        return active
          ? Promise.resolve(jsonResponse(active))
          : Promise.resolve(
              jsonResponse(
                {
                  error: {
                    code: 'validation_error',
                    message: 'No hay plantilla activa.',
                    details: {},
                  },
                },
                { status: 422 },
              ),
            );
      }
      if (method === 'GET' && /\/ticket-templates$/.test(url)) {
        return Promise.resolve(jsonResponse(templates));
      }
      if (method === 'POST' && /\/ticket-templates$/.test(url)) {
        const b = body();
        createCalls.push(b);
        const created: TicketTemplate = {
          id: templates.length + 1,
          name: b['name'] as string,
          ...PRINT_PROFILE,
          printable_width_mm: b['printable_width_mm'] as number,
          font_family: b['font_family'] as TicketTemplate['font_family'],
          font_size_px: b['font_size_px'] as number,
          line_height_px: b['line_height_px'] as number,
          font_weight: b['font_weight'] as TicketTemplate['font_weight'],
          margin_top_mm: b['margin_top_mm'] as number,
          margin_bottom_mm: b['margin_bottom_mm'] as number,
          header_text: (b['header_text'] as string) ?? '',
          footer_text: (b['footer_text'] as string) ?? '',
          tax_display: b['tax_display'] as TicketTemplate['tax_display'],
          show_line_discounts: b['show_line_discounts'] as boolean,
          store_name: (b['store_name'] as string) ?? '',
          store_tax_id: (b['store_tax_id'] as string) ?? '',
          store_address: (b['store_address'] as string) ?? '',
          store_phone: (b['store_phone'] as string) ?? '',
          sale_number_prefix: (b['sale_number_prefix'] as string) ?? 'Venta #',
          date_format: (b['date_format'] as string) ?? '%d/%m/%Y %H:%M',
          show_unit_price: (b['show_unit_price'] as boolean) ?? true,
          show_cashier: (b['show_cashier'] as boolean) ?? false,
          label_total: (b['label_total'] as string) ?? 'TOTAL',
          label_change: (b['label_change'] as string) ?? 'Cambio',
          label_cash: (b['label_cash'] as string) ?? 'Efectivo',
          label_card: (b['label_card'] as string) ?? 'Tarjeta',
          label_other: (b['label_other'] as string) ?? 'Otros',
          label_discount: (b['label_discount'] as string) ?? 'Dto.',
          tax_note: (b['tax_note'] as string) ?? 'IVA incluido',
          is_active: !templates.some((template) => template.is_active),
        };
        templates.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      const activateMatch = /\/ticket-templates\/(\d+)\/activate$/.exec(url);
      if (method === 'POST' && activateMatch) {
        const id = Number(activateMatch[1]);
        templates = templates.map((t) => ({ ...t, is_active: t.id === id }));
        return Promise.resolve(jsonResponse(templates.find((t) => t.id === id)!));
      }
      const updateMatch = /\/ticket-templates\/(\d+)$/.exec(url);
      if (method === 'PUT' && updateMatch) {
        const id = Number(updateMatch[1]);
        const b = body();
        updateCalls.push({ id, body: b });
        const current = templates.find((t) => t.id === id)!;
        const updated: TicketTemplate = { ...current, ...b };
        templates = templates.map((template) => (template.id === id ? updated : template));
        return Promise.resolve(jsonResponse(updated));
      }
      const deleteMatch = /\/ticket-templates\/(\d+)$/.exec(url);
      if (method === 'DELETE' && deleteMatch) {
        const id = Number(deleteMatch[1]);
        deleteCalls.push(id);
        templates = templates.filter((template) => template.id !== id);
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { createCalls, updateCalls, deleteCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TicketTemplatesPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('TicketTemplatesPage', () => {
  it('creates the first template, then updates it in place', async () => {
    const backend = stubBackend();
    renderPage();

    await screen.findByText('Todavía no hay ninguna plantilla activa.');
    await userEvent.click(screen.getByRole('button', { name: 'Crear plantilla' }));

    await userEvent.type(screen.getByLabelText('Nombre'), 'Tienda principal');
    await userEvent.clear(screen.getByLabelText('Ancho imprimible (mm)'));
    await userEvent.type(screen.getByLabelText('Ancho imprimible (mm)'), '48');
    await userEvent.selectOptions(screen.getByLabelText('Tipo de letra'), 'LIBERATION_MONO');
    await userEvent.clear(screen.getByLabelText('Tamaño de letra (px)'));
    await userEvent.type(screen.getByLabelText('Tamaño de letra (px)'), '10');
    await userEvent.clear(screen.getByLabelText('Interlineado (px)'));
    await userEvent.type(screen.getByLabelText('Interlineado (px)'), '14');
    await userEvent.selectOptions(screen.getByLabelText('Grosor de letra'), 'BOLD');
    await userEvent.clear(screen.getByLabelText('Margen superior (mm)'));
    await userEvent.type(screen.getByLabelText('Margen superior (mm)'), '2');
    await userEvent.clear(screen.getByLabelText('Margen inferior (mm)'));
    await userEvent.type(screen.getByLabelText('Margen inferior (mm)'), '3');
    await userEvent.type(screen.getByLabelText('Cabecera'), 'Gracias por su compra');
    // La vista previa se actualiza en vivo mientras se escribe, antes de guardar nada.
    expect(screen.getByText(/Gracias por su compra/)).toBeInTheDocument();
    expect(screen.getByText(/Gracias por su compra/).closest('pre')).toHaveClass(
      'overflow-hidden',
      'p-0',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await screen.findByText(/Activa: Tienda principal · 48 mm/);
    expect(backend.createCalls).toEqual([
      {
        name: 'Tienda principal',
        printable_width_mm: 48,
        font_family: 'LIBERATION_MONO',
        font_size_px: 10,
        line_height_px: 14,
        font_weight: 'BOLD',
        margin_top_mm: 2,
        margin_bottom_mm: 3,
        layout_template: '',
        header_text: 'Gracias por su compra',
        footer_text: '',
        tax_display: 'BREAKDOWN',
        show_line_discounts: false,
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
      },
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Editar plantilla activa' }));
    const footerInput = screen.getByLabelText('Pie');
    await userEvent.type(footerInput, 'Vuelva pronto');
    expect(screen.getByText(/Vuelva pronto/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await screen.findByText(/Activa: Tienda principal · 48 mm/);
    expect(backend.updateCalls).toEqual([
      {
        id: 1,
        body: {
          name: 'Tienda principal',
          printable_width_mm: 48,
          font_family: 'LIBERATION_MONO',
          font_size_px: 10,
          line_height_px: 14,
          font_weight: 'BOLD',
          margin_top_mm: 2,
          margin_bottom_mm: 3,
          layout_template: '',
          header_text: 'Gracias por su compra',
          footer_text: 'Vuelva pronto',
          tax_display: 'BREAKDOWN',
          show_line_discounts: false,
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
        },
      },
    ]);
  });

  it('lets the shop switch the ticket from the full breakdown to just "IVA incluido"', async () => {
    const backend = stubBackend();
    const { container } = renderPage();
    const preview = () =>
      container.querySelector('[data-ticket-template-preview]')!.textContent ?? '';

    await screen.findByText('Todavía no hay ninguna plantilla activa.');
    await userEvent.click(screen.getByRole('button', { name: 'Crear plantilla' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Tienda');

    // Por defecto, el desglose completo: una fila por tipo con base y cuota.
    expect(preview()).toContain('Cuota');
    expect(preview()).toMatch(/^21%/m);

    await userEvent.selectOptions(screen.getByLabelText('IVA en el ticket'), 'NOTE');

    // La vista previa cambia en vivo: se va la tabla, queda la nota.
    expect(preview()).not.toContain('Cuota');
    expect(preview()).toContain('IVA incluido');

    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await screen.findByText(/Activa: Tienda/);
    expect(backend.createCalls[0]).toMatchObject({ tax_display: 'NOTE' });
    expect(screen.getByText(/Sólo la nota «IVA incluido»/)).toBeInTheDocument();
  });

  it('switches which template the till prints, and edits one that is not in use', async () => {
    const backend = stubBackend();
    renderPage();

    await screen.findByText('Todavía no hay ninguna plantilla activa.');
    await userEvent.click(screen.getByRole('button', { name: 'Crear plantilla' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Antigua');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));
    await screen.findByText(/Activa: Antigua/);

    await userEvent.click(screen.getByRole('button', { name: 'Nueva plantilla' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Nueva');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));
    await screen.findByText(/Activa: Antigua/);

    // Y editar la que NO está en uso no cambia con cuál se imprime.
    const rows = screen.getAllByRole('row');
    const notInUse = rows.find((row) => row.textContent?.includes('Nueva'))!;
    await userEvent.click(within(notInUse).getByRole('button', { name: 'Editar' }));
    await userEvent.type(screen.getByLabelText('Pie'), 'Corregido');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await screen.findByText(/Activa: Antigua/);
    expect(backend.updateCalls).toHaveLength(1);
  });

  it('deletes a template that was created by mistake', async () => {
    const backend = stubBackend();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    await screen.findByText('Todavía no hay ninguna plantilla activa.');
    await userEvent.click(screen.getByRole('button', { name: 'Crear plantilla' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Errónea');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));
    await screen.findByText(/Activa: Errónea/);

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));

    expect(await screen.findByText('Todavía no hay ninguna plantilla activa.')).toBeInTheDocument();
    expect(backend.deleteCalls).toEqual([1]);
  });
});
