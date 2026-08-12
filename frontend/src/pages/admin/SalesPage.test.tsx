import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';
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
    status: 'COMPLETED',
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
      const ticket = /\/sales\/(\d+)\/tickets$/.exec(url);
      if (method === 'POST' && ticket) {
        ticketCalls.push(Number(ticket[1]));
        return Promise.resolve(
          jsonResponse({
            id: 1,
            sale_id: Number(ticket[1]),
            template_id: 1,
            width_mm: 58,
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
      sale({ id: 1043, total: '12.400000' }),
      sale({ id: 1044, total: '3.500000', status: 'CANCELLED' }),
    ]);
    // `window.print` no existe en jsdom y el botón lo llama al imprimir.
    vi.stubGlobal('print', vi.fn());
    renderPage();

    expect(await screen.findByText('#1043')).toBeInTheDocument();
    // El resumen de arriba sólo cuenta lo cobrado: una venta cancelada no
    // es caja, aunque salga en la lista.
    const summary = screen.getByText(/cobradas/).closest('p')!;
    expect(summary).toHaveTextContent('1 cobradas · 12,40 €');

    // El día sale ya puesto y se pide como dos instantes exactos, de
    // medianoche a medianoche en hora local. Mandando la fecha a secas, el
    // "hasta" acababa siendo el mismo día que el "desde" —el rango quedaba
    // vacío— y la pantalla no enseñaba ni una venta.
    const [from, to] = ['created_from', 'created_to'].map((param) =>
      new URL(backend.listUrls[0]!, 'http://x').searchParams.get(param),
    );
    expect(from).not.toBeNull();
    expect(new Date(to!).getTime() - new Date(from!).getTime()).toBe(24 * 60 * 60 * 1000);
    expect(new Date(from!).getHours()).toBe(0);

    const cancelled = screen.getByText('#1044').closest('tr')!;
    expect(within(cancelled).queryByRole('button')).not.toBeInTheDocument();

    const charged = screen.getByText('#1043').closest('tr')!;
    await userEvent.click(within(charged).getByRole('button', { name: 'Reimprimir ticket' }));

    expect(backend.ticketCalls).toEqual([1043]);
    expect(await screen.findByText('TICKET DE PRUEBA')).toBeInTheDocument();
  });

  it('asks the server again when the day or the status changes', async () => {
    const backend = stubBackend([]);
    renderPage();
    await screen.findByText('No hay ventas ese día.');

    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'DRAFT');

    expect(backend.listUrls.at(-1)).toContain('status=DRAFT');
  });
});
