import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { PosAuthProvider } from '@/features/auth/PosAuthProvider';
import { type Sale } from '@/features/returns/api';

import { PosReturnsPage } from './PosReturnsPage';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const SALE: Sale = {
  id: 42,
  status: 'COMPLETED',
  created_at: '2026-08-21T10:00:00Z',
  completed_at: '2026-08-21T10:01:00Z',
  total: '10.000000',
  lines: [
    {
      id: 1,
      product_id: 10,
      product_sku: 'P000010',
      product_name: 'Agua 1.5L',
      package_id: 100,
      package_name: 'Unidad',
      package_factor: '1',
      quantity_packages: '5',
      quantity_base: '5',
      quantity_refunded: '0',
      quantity_physically_returned: '0',
      tracks_stock: true,
      track_lots: false,
      unit_price: '2',
      total: '10',
    },
  ],
};

function stubBackend(permissions: string[]) {
  const returns: Record<string, unknown>[] = [];
  const returnKeys: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      if (url.includes('/auth/pos/me')) {
        return Promise.resolve(
          jsonResponse({
            id: 1,
            email: 'encargada@example.com',
            full_name: 'Encargada',
            role: 'MANAGER',
            permissions,
          }),
        );
      }
      if (method === 'GET' && /\/sales\?number=7$/.test(url)) {
        return Promise.resolve(
          jsonResponse([
            {
              id: SALE.id,
              number: 7,
              status: SALE.status,
              created_at: SALE.created_at,
              total: SALE.total,
              warehouse_id: 1,
              location_id: 1,
              terminal_id: 7,
              terminal_name: 'Caja 1',
              notes: '',
              lines: [],
              payments: [],
              change_due: '0.000000',
            },
          ]),
        );
      }
      if (method === 'GET' && /\/sales\/42$/.test(url)) return Promise.resolve(jsonResponse(SALE));
      if (method === 'POST' && /\/sales\/42\/returns$/.test(url)) {
        returnKeys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
        const payload = JSON.parse(init?.body as string) as Record<string, unknown>;
        returns.push(payload);
        return Promise.resolve(
          jsonResponse(
            {
              id: 1,
              sale_id: SALE.id,
              notes: payload['notes'],
              processed_by_user_id: 1,
              created_at: '2026-08-21T10:05:00Z',
              total_refund: '2',
              refund: {
                id: 1,
                return_id: 1,
                amount: '2',
                method: payload['refund_method'],
                status: 'COMPLETED',
                processed_by_user_id: 1,
                created_at: '2026-08-21T10:05:00Z',
                completed_at: '2026-08-21T10:05:00Z',
              },
              lines: [
                {
                  id: 1,
                  sale_line_id: 1,
                  product_id: 10,
                  product_sku: 'P000010',
                  product_name: 'Agua 1.5L',
                  package_id: 100,
                  package_name: 'Unidad',
                  refund_quantity_packages: '1',
                  refund_quantity_base: '1',
                  stock_return_quantity_packages: '1',
                  stock_return_quantity_base: '1',
                  refund_amount: '2',
                  lot_id: null,
                  lot_number: null,
                  stock_movement_id: 1,
                },
              ],
            },
            { status: 201 },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );
  return { returns, returnKeys };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PosAuthProvider>
        <MemoryRouter initialEntries={['/pos/returns']}>
          <Routes>
            <Route path="/pos/returns" element={<PosReturnsPage />} />
            <Route path="/pos" element={<p>TPV</p>} />
          </Routes>
        </MemoryRouter>
      </PosAuthProvider>
    </QueryClientProvider>,
  );
}

describe('PosReturnsPage', () => {
  it('opens a touch keypad to enter the ticket number for a return', async () => {
    stubBackend(['pos.access', 'sale.read', 'return.manage']);
    renderPage();

    await userEvent.click(await screen.findByLabelText('Nº de venta'));
    const dialog = await screen.findByRole('dialog', { name: 'Introducir número de venta' });
    const keypad = within(dialog).getByLabelText('Teclado numérico para número de venta');
    await userEvent.click(within(keypad).getByRole('button', { name: '7' }));
    await userEvent.click(within(keypad).getByRole('button', { name: 'Buscar venta' }));

    expect(await screen.findByText(/Venta #7/)).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Introducir número de venta' }),
    ).not.toBeInTheDocument();
  });

  it('lets an authorized POS supervisor return a completed sale using the POS session', async () => {
    const backend = stubBackend(['pos.access', 'sale.read', 'return.manage']);
    renderPage();

    // La entrada física sigue disponible: el teclado táctil sólo se abre
    // al tocar el recuadro, no cuando el lector/teclado ya escribe en él.
    fireEvent.change(await screen.findByLabelText('Nº de venta'), { target: { value: '7' } });
    await userEvent.click(screen.getByRole('button', { name: 'Buscar venta' }));
    await screen.findByText(/Venta #7/);

    await userEvent.selectOptions(screen.getByLabelText('Línea vendida'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir a la devolución' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar devolución' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Devolución registrada correctamente.',
    );
    expect(backend.returnKeys[0]).not.toBe('');
    expect(backend.returns).toEqual([
      {
        notes: '',
        lines: [
          {
            sale_line_id: 1,
            refund_quantity_packages: '1',
            stock_return_quantity_packages: '1',
            lot_number: null,
          },
        ],
        refund_method: 'CASH',
      },
    ]);
  });

  it('does not expose a return screen to a POS cashier without return.manage', async () => {
    stubBackend(['pos.access', 'sale.read']);
    renderPage();

    expect(await screen.findByText('TPV')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Devolución' })).not.toBeInTheDocument();
  });
});
