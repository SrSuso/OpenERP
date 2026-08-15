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

function stubBackend() {
  let templates: TicketTemplate[] = [];
  const createCalls: Record<string, unknown>[] = [];
  const reviseCalls: { id: number; body: Record<string, unknown> }[] = [];
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
        templates = templates.map((t) => ({ ...t, is_active: false }));
        const created: TicketTemplate = {
          id: templates.length + 1,
          name: b['name'] as string,
          version: 1,
          width_mm: b['width_mm'] as 58 | 80,
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
          is_active: true,
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
      const reviseMatch = /\/ticket-templates\/(\d+)\/revise$/.exec(url);
      if (method === 'POST' && reviseMatch) {
        const id = Number(reviseMatch[1]);
        const b = body();
        reviseCalls.push({ id, body: b });
        const current = templates.find((t) => t.id === id)!;
        const wasActive = current.is_active;
        current.is_active = false;
        const revised: TicketTemplate = {
          id: templates.length + 1,
          name: current.name,
          version: current.version + 1,
          width_mm: b['width_mm'] as 58 | 80,
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
          // El backend conserva si estaba en uso o no.
          is_active: wasActive,
        };
        templates.push(revised);
        return Promise.resolve(jsonResponse(revised));
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

  return { createCalls, reviseCalls, deleteCalls };
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
  it('creates the first template, then revises it into a new version', async () => {
    const backend = stubBackend();
    renderPage();

    await screen.findByText('Todavía no hay ninguna plantilla activa.');
    await userEvent.click(screen.getByRole('button', { name: 'Crear plantilla' }));

    await userEvent.type(screen.getByLabelText('Nombre'), 'Tienda principal');
    await userEvent.selectOptions(screen.getByLabelText('Ancho del papel'), '58');
    await userEvent.type(screen.getByLabelText('Cabecera'), 'Gracias por su compra');
    // La vista previa se actualiza en vivo mientras se escribe, antes de guardar nada.
    expect(screen.getByText(/Gracias por su compra/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await screen.findByText(/Activa: Tienda principal · v1 · 58 mm/);
    expect(backend.createCalls).toEqual([
      {
        name: 'Tienda principal',
        width_mm: 58,
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

    await userEvent.click(screen.getByRole('button', { name: 'Revisar' }));
    const footerInput = screen.getByLabelText('Pie');
    await userEvent.type(footerInput, 'Vuelva pronto');
    expect(screen.getByText(/Vuelva pronto/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar nueva versión' }));

    await screen.findByText(/Activa: Tienda principal · v2 · 58 mm/);
    expect(backend.reviseCalls).toEqual([
      {
        id: 1,
        body: {
          width_mm: 58,
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
    const preview = () => container.querySelector('pre')!.textContent ?? '';

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

    await userEvent.click(screen.getByRole('button', { name: 'Nueva plantilla (otro nombre)' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Nueva');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));
    await screen.findByText(/Activa: Nueva/);

    // Volver a la primera desde la lista.
    await userEvent.click(screen.getAllByRole('button', { name: 'Usar esta' })[0]!);
    await screen.findByText(/Activa: Antigua/);

    // Y editar la que NO está en uso no cambia con cuál se imprime.
    const rows = screen.getAllByRole('row');
    const notInUse = rows.find((row) => row.textContent?.includes('Nueva'))!;
    await userEvent.click(within(notInUse).getByRole('button', { name: 'Editar' }));
    await userEvent.type(screen.getByLabelText('Pie'), 'Corregido');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar nueva versión' }));

    await screen.findByText(/Activa: Antigua/);
    expect(backend.reviseCalls).toHaveLength(1);
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
