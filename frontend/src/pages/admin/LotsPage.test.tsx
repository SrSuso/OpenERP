import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';
import { type Product } from '@/features/catalog/api';
import { type Location, type Warehouse } from '@/features/inventory/api';
import { type FefoAllocation, type Lot, type LotBalance } from '@/features/lots/api';
import { type Supplier } from '@/features/suppliers/api';

import { LotsPage } from './LotsPage';

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
  permissions: ['admin.access', 'lot.read', 'lot.manage'],
};

function stubBackend() {
  const product: Product = {
    id: 10,
    sku: 'P000010',
    name: 'Yogur natural',
    description: '',
    category_id: null,
    category_name: null,
    pos_category_id: null,
    pos_category_name: null,
    pos_display_order: 0,
    base_unit_name: 'UNIT',
    cost: '0.500000',
    list_price: '1.000000',
    tax_rate: '0',
    surcharge_rate: '0',
    margin_rate: null,
    taxes: [],
    price_formula: null,
    min_stock: '0',
    track_lots: true,
    track_expiration: true,
    is_active: true,
    packages: [],
  };
  const supplier: Supplier = {
    id: 1,
    name: 'Lácteos SA',
    tax_id: null,
    email: null,
    phone: null,
    address: '',
    is_active: true,
  };
  const warehouse: Warehouse = { id: 1, name: 'Almacén central', is_active: true };
  const location: Location = { id: 1, warehouse_id: 1, name: 'Cámara', is_active: true };
  const lots: Lot[] = [];
  let nextLotId = 1;
  const balances: LotBalance[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = () =>
        init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (method === 'GET' && /\/products\?/.test(url))
        return Promise.resolve(jsonResponse([product]));
      if (method === 'GET' && /\/suppliers\?/.test(url))
        return Promise.resolve(jsonResponse([supplier]));
      if (method === 'GET' && /\/warehouses$/.test(url))
        return Promise.resolve(jsonResponse([warehouse]));
      if (method === 'GET' && /\/warehouses\/\d+\/locations/.test(url)) {
        return Promise.resolve(jsonResponse([location]));
      }

      if (method === 'GET' && /\/lots\?/.test(url)) return Promise.resolve(jsonResponse(lots));
      if (method === 'POST' && /\/lots$/.test(url)) {
        const b = body();
        const lot: Lot = {
          id: nextLotId++,
          product_id: b['product_id'] as number,
          product_sku: product.sku,
          lot_number: b['lot_number'] as string,
          manufacturing_date: (b['manufacturing_date'] as string | null) ?? null,
          expiration_date: (b['expiration_date'] as string | null) ?? null,
          supplier_id: (b['supplier_id'] as number | null) ?? null,
          purchase_order_id: null,
        };
        lots.push(lot);
        balances.push({ lot, quantity: '10' });
        return Promise.resolve(jsonResponse(lot, { status: 201 }));
      }
      if (method === 'GET' && /\/lot-balances\?/.test(url)) {
        return Promise.resolve(jsonResponse(balances));
      }
      if (method === 'POST' && /\/fefo-plan$/.test(url)) {
        const allocations: FefoAllocation[] = balances.map((b) => ({
          lot_id: b.lot.id,
          lot_number: b.lot.lot_number,
          expiration_date: b.lot.expiration_date,
          quantity: b.quantity,
        }));
        return Promise.resolve(jsonResponse({ allocations }));
      }
      if (method === 'POST' && /\/fefo-consume$/.test(url)) {
        const allocations: FefoAllocation[] = balances.map((b) => ({
          lot_id: b.lot.id,
          lot_number: b.lot.lot_number,
          expiration_date: b.lot.expiration_date,
          quantity: b.quantity,
        }));
        return Promise.resolve(jsonResponse({ allocations, movement_ids: [1] }));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <LotsPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('LotsPage', () => {
  it('creates a lot with an expiration date and shows the FEFO plan for it', async () => {
    stubBackend();
    renderPage();

    await screen.findByText(/P000010/);
    await userEvent.selectOptions(screen.getByLabelText('Producto'), '10');
    await screen.findByText('Este producto todavía no tiene lotes.');

    await userEvent.type(screen.getByLabelText('Nº de lote'), 'L2026-01');
    await userEvent.type(screen.getByLabelText('Caducidad (opcional)'), '2026-09-01');
    await userEvent.selectOptions(screen.getByLabelText('Proveedor (opcional)'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Crear lote' }));

    await screen.findByText('L2026-01');
    expect(screen.getByText('2026-09-01')).toBeInTheDocument();

    // Saldo por lote + plan FEFO
    await userEvent.selectOptions(screen.getByLabelText('Almacén'), '1');
    await userEvent.selectOptions(screen.getByLabelText('Ubicación'), '1');
    // Aparece dos veces: en la tabla de lotes del producto y en el saldo
    // por lote del almacén/ubicación elegidos.
    expect(await screen.findAllByText('L2026-01')).toHaveLength(2);

    await userEvent.type(screen.getByLabelText('Cantidad a sacar'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Ver plan' }));

    const fefoList = await screen.findByText(/Lote L2026-01 \(caduca 2026-09-01\)/);
    expect(within(fefoList.closest('ul')!).getByText(/Lote L2026-01/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar salida' }));
    expect(await screen.findByText(/Lote L2026-01 \(caduca 2026-09-01\)/)).toBeInTheDocument();
  });
});
