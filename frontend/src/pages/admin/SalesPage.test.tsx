import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type Sale } from '@/features/pos/api';

import { SalesPage } from './SalesPage';

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
  permissions: ['admin.access', 'sale.read', 'ticket.manage'],
};

function sale(overrides: Partial<Sale> & { id: number }): Sale {
  return {
    warehouse_id: 1,
    location_id: 1,
    terminal_id: 7,
    terminal_name: 'Caja 1',
    status: 'COMPLETED',
    number: null,
    notes: '',
    created_at: '2026-08-11T09:30:00Z',
    lines: [],
    total: '12.400000',
    payments: [],
    change_due: '0.000000',
    ...overrides,
  };
}

function stubBackend(sales: Sale[]) {
  const listUrls: string[] = [];
  const ticketCalls: number[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (method === 'GET' && url.includes('/settings/values')) {
        return Promise.resolve(jsonResponse({ 'business.timezone': 'Europe/Madrid' }));
      }
      const ticket = /\/sales\/(\d+)\/tickets$/.exec(url);
      if (method === 'POST' && ticket) {
        ticketCalls.push(Number(ticket[1]));
        return Promise.resolve(
          jsonResponse({
            id: 1,
            sale_id: Number(ticket[1]),
            template_id: 1,
            printable_width_mm: 48,
            margin_left_mm: 16,
            margin_right_mm: 16,
            font_family: 'COURIER_NEW',
            font_size_px: 9,
            line_height_px: 12,
            font_weight: 'NORMAL',
            margin_top_mm: 0,
            margin_bottom_mm: 0,
            rendered_text: 'TICKET DE PRUEBA',
            created_at: '2026-08-11T09:31:00Z',
          }),
        );
      }
      if (method === 'GET' && url.includes('/sales?')) {
        listUrls.push(url);
        return Promise.resolve(jsonResponse(sales));
      }
      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { listUrls, ticketCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SalesPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('SalesPage', () => {
  it("lists the day's sales with their takings, and reprints one", async () => {
    const backend = stubBackend([
      sale({
        id: 1043,
        number: 12,
        total: '12.400000',
        completed_at: '2026-08-12T22:30:00Z',
      }),
      sale({ id: 1044, number: null, status: 'DRAFT', total: '3.500000' }),
    ]);
    // `window.print` no existe en jsdom y el botón lo llama al imprimir.
    vi.stubGlobal('print', vi.fn());
    renderPage();

    // Se identifica por el número impreso en el ticket, no por el id.
    expect(await screen.findByText('#12')).toBeInTheDocument();
    // El resumen de arriba sólo cuenta lo cobrado: una venta cancelada no
    // es caja, aunque salga en la lista.
    const summary = screen.getByText(/cobradas/).closest('p')!;
    expect(summary).toHaveTextContent('1 cobradas · 12,40 €');

    // El navegador no fabrica instantes: envía la fecha lógica y el
    // backend construye sus límites con la timezone de la tienda.
    const params = new URL(backend.listUrls[0]!, 'http://x').searchParams;
    expect(params.get('business_date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.has('created_from')).toBe(false);
    expect(params.has('created_to')).toBe(false);
    // Aunque el entorno de test/navegador esté en otra zona, 22:30Z es
    // medianoche y media del día siguiente en Madrid.
    expect(screen.getByText('00:30')).toBeInTheDocument();

    // Un carrito sin cobrar no tiene número ni ticket que reimprimir.
    const pending = screen.getByText('sin número').closest('tr')!;
    expect(within(pending).queryByRole('button')).not.toBeInTheDocument();

    const charged = screen.getByText('#12').closest('tr')!;
    await userEvent.click(within(charged).getByRole('button', { name: 'Reimprimir ticket' }));

    expect(backend.ticketCalls).toEqual([1043]);
    expect(await screen.findByText('TICKET DE PRUEBA')).toBeInTheDocument();
    // El documento permanece activo mientras Chromium compone la
    // previsualización. `afterprint` se dispara tanto al confirmar como al
    // cancelar y entonces deja de poder sumarse a otra reimpresión.
    expect(document.body.classList).toContain('printing-thermal-document');
    await act(() => window.dispatchEvent(new Event('afterprint')));
    await waitFor(() => expect(document.body.classList).not.toContain('printing-thermal-document'));
    expect(within(charged).getByRole('button', { name: 'Reimprimir ticket' })).toBeInTheDocument();
  });

  it('asks the server again when the day or the status changes', async () => {
    const backend = stubBackend([]);
    renderPage();
    await screen.findByText('No hay ventas ese día.');

    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'DRAFT');

    expect(backend.listUrls.at(-1)).toContain('status=DRAFT');

    fireEvent.change(screen.getByLabelText('Día'), { target: { value: '2026-08-13' } });
    await waitFor(() => expect(backend.listUrls.at(-1)).toContain('business_date=2026-08-13'));
  });
});
