import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';

import { PosLayout } from './PosLayout';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const ME = {
  id: 1,
  email: 'cajera@example.com',
  full_name: 'Ana',
  role: 'CASHIER',
  permissions: ['pos.access', 'sale.read', 'sale.manage'],
};

const PREVIEW = {
  covers_from: null,
  sales_count: 3,
  gross_total: '41.800000',
  tax_total: '3.800000',
  discount_total: '0.000000',
  cash_total: '25.000000',
  card_total: '16.800000',
  other_total: '0.000000',
  returns_count: 0,
  returns_total: '0.000000',
  open_sales: 0,
};

function stubBackend(options: { openSales?: number } = {}) {
  const closeCalls: string[] = [];
  const logoutCalls: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (url.includes('/auth/logout')) {
        logoutCalls.push(url);
        return Promise.resolve(jsonResponse({}));
      }
      if (url.includes('/settings/values')) return Promise.resolve(jsonResponse({}));
      if (url.includes('/warehouses')) {
        return Promise.resolve(jsonResponse([{ id: 1, name: 'Tienda', is_active: true }]));
      }
      if (url.includes('/z-reports/preview')) {
        return Promise.resolve(jsonResponse({ ...PREVIEW, open_sales: options.openSales ?? 0 }));
      }
      if (method === 'POST' && url.includes('/z-reports')) {
        closeCalls.push(url);
        return Promise.resolve(
          jsonResponse(
            {
              ...PREVIEW,
              id: 9,
              warehouse_id: 1,
              number: 7,
              closed_at: '2026-08-11T20:00:00Z',
              closed_by_user_id: 1,
            },
            { status: 201 },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { closeCalls, logoutCalls };
}

function renderLayout() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/pos']}>
          <PosLayout />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('PosLayout', () => {
  it('will not sign out until the till has been closed with a Z', async () => {
    const backend = stubBackend();
    vi.stubGlobal('print', vi.fn());
    renderLayout();
    await screen.findByText('Ana');

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    // Sale el cierre, no la sesión: todavía no se ha ido nadie.
    const dialog = await screen.findByRole('dialog', { name: 'Cierre de caja' });
    expect(backend.logoutCalls).toEqual([]);
    expect(await screen.findByText('41,80 €')).toBeInTheDocument();
    expect(screen.getByText('25,00 €')).toBeInTheDocument();

    // Y se puede volver a vender sin cerrar nada.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Seguir vendiendo' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(backend.closeCalls).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar caja e imprimir Z' }));

    // Z guardada y con su número; sólo entonces se sale.
    expect(await screen.findByText('Cierre Z nº 7')).toBeInTheDocument();
    expect(backend.closeCalls).toHaveLength(1);
    expect(backend.logoutCalls).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(backend.logoutCalls).toHaveLength(1);
  });

  it('does not let the till be closed with a sale in progress', async () => {
    stubBackend({ openSales: 2 });
    renderLayout();
    await screen.findByText('Ana');

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByText(/2 ventas sin cobrar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar caja e imprimir Z' })).toBeDisabled();
  });
});
