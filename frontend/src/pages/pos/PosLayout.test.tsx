import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { POS_TERMINAL_STORAGE_KEY } from '@/features/pos/PosTerminalProvider';

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

const TERMINAL = {
  id: 7,
  name: 'Caja 1',
  warehouse_id: 1,
  warehouse_name: 'Tienda',
  is_active: true,
  created_at: '2026-08-11T09:00:00Z',
};
const TERMINAL_2 = { ...TERMINAL, id: 8, name: 'Caja 2' };

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
  open_sales: [],
};

function stubBackend(
  options: {
    openSales?: { id: number; lines_count: number; total: string }[];
    failFirstClose?: boolean;
    terminals?: (typeof TERMINAL)[];
  } = {},
) {
  const closeCalls: string[] = [];
  const closeKeys: string[] = [];
  const logoutCalls: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (url.includes('/auth/logout')) {
        logoutCalls.push(url);
        // 204 sin cuerpo, como el backend de verdad
        // (backend/app/auth/router.py). Devolviendo `{}` el esquema de
        // `logout()` (z.null()) reventaba y el error salía por consola en
        // cada ejecución del suite, sin que ninguna prueba se enterara.
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes('/settings/values')) return Promise.resolve(jsonResponse({}));
      if (url.includes('/pos-terminals')) {
        return Promise.resolve(jsonResponse(options.terminals ?? [TERMINAL]));
      }
      // La caja pregunta por esta huella cada pocos segundos para saber si
      // el panel ha cambiado algo (ver `useLiveCatalog`).
      if (url.includes('/catalog-version')) {
        return Promise.resolve(jsonResponse({ version: 'v1' }));
      }
      if (url.includes('/warehouses')) {
        return Promise.resolve(jsonResponse([{ id: 1, name: 'Tienda', is_active: true }]));
      }
      if (url.includes('/z-reports/preview')) {
        return Promise.resolve(jsonResponse({ ...PREVIEW, open_sales: options.openSales ?? [] }));
      }
      if (method === 'POST' && url.includes('/z-reports')) {
        closeCalls.push(url);
        closeKeys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
        if (options.failFirstClose && closeCalls.length === 1) {
          return Promise.reject(new TypeError('Connection lost after sending request'));
        }
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

  return { closeCalls, closeKeys, logoutCalls };
}

function renderLayout({ configured = true }: { configured?: boolean } = {}) {
  if (configured) window.localStorage.setItem(POS_TERMINAL_STORAGE_KEY, String(TERMINAL.id));
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
  beforeEach(() => window.localStorage.clear());

  it('requires an explicit terminal selection and persists it for later logins', async () => {
    stubBackend();
    renderLayout({ configured: false });

    expect(
      await screen.findByRole('heading', { name: 'Seleccionar terminal' }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(POS_TERMINAL_STORAGE_KEY)).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: /Caja 1/ }));

    expect(await screen.findByRole('button', { name: 'Caja 1' })).toBeInTheDocument();
    expect(window.localStorage.getItem(POS_TERMINAL_STORAGE_KEY)).toBe('7');
  });

  it('blocks an inactive stored terminal without discarding its identity', async () => {
    stubBackend({ terminals: [] });
    renderLayout();

    expect(await screen.findByText(/terminal configurado ya no está activo/i)).toBeInTheDocument();
    expect(window.localStorage.getItem(POS_TERMINAL_STORAGE_KEY)).toBe('7');
  });

  it('changes terminal only after an explicit choice', async () => {
    stubBackend({ terminals: [TERMINAL, TERMINAL_2] });
    renderLayout();
    const current = await screen.findByRole('button', { name: 'Caja 1' });

    await userEvent.click(current);
    expect(screen.getByRole('heading', { name: 'Seleccionar terminal' })).toBeInTheDocument();
    expect(window.localStorage.getItem(POS_TERMINAL_STORAGE_KEY)).toBe('7');
    await userEvent.click(screen.getByRole('button', { name: /Caja 2/ }));

    expect(await screen.findByRole('button', { name: 'Caja 2' })).toBeInTheDocument();
    expect(window.localStorage.getItem(POS_TERMINAL_STORAGE_KEY)).toBe('8');
  });

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
    // The register is a browser identity, not a cashier-session identity.
    expect(window.localStorage.getItem(POS_TERMINAL_STORAGE_KEY)).toBe('7');
  });

  it('says which sales are in the way, not just how many', async () => {
    // "Hay una venta sin cobrar" a secas deja sin salida a quien está en el
    // mostrador: no sabe cuál buscar.
    stubBackend({
      openSales: [
        { id: 12, lines_count: 3, total: '8.400000' },
        { id: 15, lines_count: 1, total: '1.200000' },
      ],
    });
    renderLayout();
    await screen.findByText('Ana');

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByText(/2 ventas sin cobrar/)).toBeInTheDocument();
    expect(screen.getByText(/Venta #12 — 3 líneas · 8,40 €/)).toBeInTheDocument();
    expect(screen.getByText(/Venta #15 — 1 línea · 1,20 €/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar caja e imprimir Z' })).toBeDisabled();
  });

  it('reuses the Z idempotency key after an uncertain transport error', async () => {
    const backend = stubBackend({ failFirstClose: true });
    vi.stubGlobal('print', vi.fn());
    renderLayout();
    await screen.findByText('Ana');

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    const closeButton = await screen.findByRole('button', { name: 'Cerrar caja e imprimir Z' });
    await userEvent.click(closeButton);
    await screen.findByText('No se ha podido cerrar la caja.');
    await userEvent.click(closeButton);

    await screen.findByText('Cierre Z nº 7');
    await waitFor(() => expect(backend.closeKeys).toHaveLength(2));
    expect(backend.closeKeys[0]).not.toBe('');
    expect(backend.closeKeys[1]).toBe(backend.closeKeys[0]);
  });
});
