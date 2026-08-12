import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';
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

function stubBackend() {
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
        quantity_returned: '0',
        unit_price: '2',
        total: '10',
      },
    ],
  };
  let returns: Return[] = [];
  const createCalls: Record<string, unknown>[] = [];

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
              width_mm: 58,
              rendered_text: 'Venta #42\nTOTAL 10.00\n',
              created_at: new Date().toISOString(),
            },
            { status: 201 },
          ),
        );
      }
      if (method === 'POST' && /\/sales\/42\/returns$/.test(url)) {
        const b = body();
        createCalls.push(b);
        const lines = b['lines'] as {
          sale_line_id: number;
          quantity_packages: string;
          economic: boolean;
          physical: boolean;
          lot_number: string | null;
        }[];
        const ret: Return = {
          id: 1,
          sale_id: 42,
          notes: (b['notes'] as string) ?? '',
          processed_by_user_id: 1,
          created_at: new Date().toISOString(),
          total_refund: '4.000000',
          lines: lines.map((l, i) => ({
            id: i + 1,
            sale_line_id: l.sale_line_id,
            product_id: 10,
            product_sku: 'P000010',
            product_name: 'Agua 1.5L',
            package_id: 100,
            package_name: 'Unidad',
            quantity_packages: l.quantity_packages,
            quantity_base: l.quantity_packages,
            is_economic: l.economic,
            is_physical: l.physical,
            refund_amount: l.economic ? '4.000000' : '0',
            lot_id: null,
            lot_number: l.lot_number,
            stock_movement_id: l.physical ? 1 : null,
          })),
        };
        returns = [ret];
        sale.lines[0]!.quantity_returned = String(
          Number(sale.lines[0]!.quantity_returned) +
            lines.reduce((sum, l) => sum + Number(l.quantity_packages), 0),
        );
        return Promise.resolve(jsonResponse(ret, { status: 201 }));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { createCalls };
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
    const backend = stubBackend();
    renderPage();

    await userEvent.type(screen.getByLabelText('Nº de venta'), '7');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    await screen.findByText(/Venta #7/);
    await screen.findByText('Todavía no se ha devuelto nada de esta venta.');

    await userEvent.selectOptions(screen.getByLabelText('Línea vendida'), '1');
    const qtyInput = screen.getByLabelText('Cantidad');
    await userEvent.clear(qtyInput);
    await userEvent.type(qtyInput, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir a la devolución' }));

    await screen.findByText(/reembolso.*repone stock/);
    await userEvent.click(screen.getByRole('button', { name: 'Registrar devolución' }));

    expect(await screen.findAllByText(/reembolso 4,00/)).not.toHaveLength(0);
    expect(backend.createCalls).toEqual([
      {
        notes: '',
        lines: [
          {
            sale_line_id: 1,
            quantity_packages: '2',
            economic: true,
            physical: true,
            lot_number: null,
          },
        ],
      },
    ]);
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
