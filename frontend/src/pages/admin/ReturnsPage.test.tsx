import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type Return, type Sale } from '@/features/returns/api';

import { ReturnsPage } from './ReturnsPage';

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
  permissions: ['admin.access', 'return.read', 'return.manage'],
};

function stubBackend(options: { failReturnOnce?: boolean } = {}) {
  const sale: Sale = {
    id: 42,
    status: 'COMPLETED',
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
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
  let returns: Return[] = [];
  const createCalls: Record<string, unknown>[] = [];
  const returnKeys: string[] = [];
  let returnFailures = options.failReturnOnce ? 1 : 0;

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = () =>
        init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (method === 'GET' && /\/sales\?number=7$/.test(url)) {
        // La búsqueda por número devuelve la venta completa del TPV, que
        // trae más campos que la forma reducida de devoluciones.
        return Promise.resolve(
          jsonResponse([
            // Sólo hace falta para resolver el número al id: el detalle de
            // la venta se pide aparte, con su propia forma.
            {
              id: sale.id,
              number: 7,
              status: sale.status,
              created_at: sale.created_at,
              total: sale.total,
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
      if (method === 'GET' && /\/sales\?number=/.test(url))
        return Promise.resolve(jsonResponse([]));
      if (method === 'GET' && /\/sales\/42$/.test(url)) return Promise.resolve(jsonResponse(sale));
      if (method === 'GET' && /\/sales\/42\/returns$/.test(url)) {
        return Promise.resolve(jsonResponse(returns));
      }
      if (method === 'POST' && /\/sales\/42\/tickets$/.test(url)) {
        return Promise.resolve(
          jsonResponse(
            {
              id: 1,
              sale_id: 42,
              template_id: 1,
              printable_width_mm: 48,
              font_family: 'COURIER_NEW',
              font_size_px: 9,
              line_height_px: 12,
              font_weight: 'NORMAL',
              margin_top_mm: 0,
              margin_bottom_mm: 0,
              rendered_text: 'Venta #42\nTOTAL 10.00\n',
              created_at: new Date().toISOString(),
            },
            { status: 201 },
          ),
        );
      }
      if (method === 'POST' && /\/sales\/42\/returns$/.test(url)) {
        returnKeys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
        if (returnFailures > 0) {
          returnFailures -= 1;
          return Promise.reject(new TypeError('Network request failed'));
        }
        const b = body();
        createCalls.push(b);
        const lines = b['lines'] as {
          sale_line_id: number;
          refund_quantity_packages: string;
          stock_return_quantity_packages: string;
          lot_number: string | null;
        }[];
        const refunded = lines.reduce(
          (sum, line) => sum + Number(line.refund_quantity_packages),
          0,
        );
        const ret: Return = {
          id: 1,
          sale_id: 42,
          notes: (b['notes'] as string) ?? '',
          processed_by_user_id: 1,
          created_at: new Date().toISOString(),
          total_refund: String(refunded * 2),
          refund:
            refunded > 0
              ? {
                  id: 1,
                  return_id: 1,
                  amount: String(refunded * 2),
                  method: b['refund_method'] as 'CASH' | 'CARD' | 'OTHER',
                  status: 'COMPLETED',
                  processed_by_user_id: 1,
                  created_at: new Date().toISOString(),
                  completed_at: new Date().toISOString(),
                }
              : null,
          lines: lines.map((l, i) => ({
            id: i + 1,
            sale_line_id: l.sale_line_id,
            product_id: 10,
            product_sku: 'P000010',
            product_name: 'Agua 1.5L',
            package_id: 100,
            package_name: 'Unidad',
            refund_quantity_packages: l.refund_quantity_packages,
            refund_quantity_base: l.refund_quantity_packages,
            stock_return_quantity_packages: l.stock_return_quantity_packages,
            stock_return_quantity_base: l.stock_return_quantity_packages,
            refund_amount: String(Number(l.refund_quantity_packages) * 2),
            lot_id: null,
            lot_number: l.lot_number,
            stock_movement_id: Number(l.stock_return_quantity_packages) > 0 ? 1 : null,
          })),
        };
        returns = [ret];
        sale.lines[0]!.quantity_refunded = String(
          Number(sale.lines[0]!.quantity_refunded) + refunded,
        );
        sale.lines[0]!.quantity_physically_returned = String(
          Number(sale.lines[0]!.quantity_physically_returned) +
            lines.reduce((sum, l) => sum + Number(l.stock_return_quantity_packages), 0),
        );
        return Promise.resolve(jsonResponse(ret, { status: 201 }));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { createCalls, returnKeys };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ReturnsPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('ReturnsPage', () => {
  it('looks up a completed sale and processes a partial, refund-and-restock return', async () => {
    const backend = stubBackend({ failReturnOnce: true });
    renderPage();

    await userEvent.type(screen.getByLabelText('Nº de venta'), '7');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    await screen.findByText(/Venta #7/);
    await screen.findByText('Todavía no se ha devuelto nada de esta venta.');

    await userEvent.selectOptions(screen.getByLabelText('Línea vendida'), '1');
    const qtyInput = screen.getByLabelText('Cantidad a reembolsar');
    await userEvent.clear(qtyInput);
    await userEvent.type(qtyInput, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir a la devolución' }));

    await screen.findByText(/devuelve 2.*repone 2/);
    await userEvent.click(screen.getByRole('button', { name: 'Registrar devolución' }));
    await screen.findByText('No se ha podido registrar la devolución.');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar devolución' }));

    expect(await screen.findAllByText(/reembolso 4,00/)).not.toHaveLength(0);
    expect(backend.returnKeys[0]).not.toBe('');
    expect(backend.returnKeys[1]).toBe(backend.returnKeys[0]);
    expect(backend.createCalls).toEqual([
      {
        notes: '',
        lines: [
          {
            sale_line_id: 1,
            refund_quantity_packages: '2',
            stock_return_quantity_packages: '2',
            lot_number: null,
          },
        ],
        refund_method: 'CASH',
      },
    ]);
  });

  it('submits independent economic and stock quantities with the confirmed method', async () => {
    const backend = stubBackend();
    renderPage();
    await userEvent.type(screen.getByLabelText('Nº de venta'), '7');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await screen.findByText(/Venta #7/);

    await userEvent.selectOptions(screen.getByLabelText('Línea vendida'), '1');
    const refund = screen.getByLabelText('Cantidad a reembolsar');
    const stock = screen.getByLabelText('Cantidad que vuelve a stock');
    await userEvent.clear(refund);
    await userEvent.type(refund, '3');
    expect(stock).toHaveValue('3');
    await userEvent.clear(stock);
    await userEvent.type(stock, '1');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir a la devolución' }));
    await userEvent.selectOptions(screen.getByLabelText('Medio del reembolso'), 'CARD');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar devolución' }));

    expect(await screen.findByText(/devuelto 3.*repuesto 1/)).toBeInTheDocument();
    expect(backend.createCalls).toEqual([
      {
        notes: '',
        lines: [
          {
            sale_line_id: 1,
            refund_quantity_packages: '3',
            stock_return_quantity_packages: '1',
            lot_number: null,
          },
        ],
        refund_method: 'CARD',
      },
    ]);
  });

  it('keeps a physical-only goodwill return free of refund method and entity', async () => {
    const backend = stubBackend();
    renderPage();
    await userEvent.type(screen.getByLabelText('Nº de venta'), '7');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await screen.findByText(/Venta #7/);

    await userEvent.selectOptions(screen.getByLabelText('Línea vendida'), '1');
    const refund = screen.getByLabelText('Cantidad a reembolsar');
    const stock = screen.getByLabelText('Cantidad que vuelve a stock');
    await userEvent.clear(refund);
    await userEvent.type(refund, '0');
    await userEvent.clear(stock);
    await userEvent.type(stock, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir a la devolución' }));

    expect(screen.queryByLabelText('Medio del reembolso')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar devolución' }));
    expect(await screen.findByText(/sin reembolso económico/)).toBeInTheDocument();
    expect(backend.createCalls[0]).not.toHaveProperty('refund_method');
  });

  it('reprints the frozen ticket of a completed sale and triggers window.print()', async () => {
    stubBackend();
    const printMock = vi.fn();
    vi.stubGlobal('print', printMock);
    renderPage();

    await userEvent.type(screen.getByLabelText('Nº de venta'), '7');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await screen.findByText(/Venta #7/);

    await userEvent.click(screen.getByRole('button', { name: 'Reimprimir ticket' }));

    await screen.findByText(/TOTAL 10\.00/);
    expect(printMock).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByText(/TOTAL 10\.00/)).not.toBeInTheDocument();
  });
});
