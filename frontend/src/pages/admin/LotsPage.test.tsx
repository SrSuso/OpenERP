import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
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

function stubBackend({ failFirstConsume = false }: { failFirstConsume?: boolean } = {}) {
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
    effective_tax_rate: '0',
    surcharge_rate: '0',
    margin_rate: null,
    margin_amount: null,
    taxes: [],
    price_formula: null,
    min_stock: '0',
    track_lots: true,
    track_expiration: true,
    tracks_stock: null,
    effective_tracks_stock: true,
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
  const consumeKeys: string[] = [];
  const lotCreateCalls: Record<string, unknown>[] = [];
  const lotStockSetCalls: Record<string, unknown>[] = [];

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
        lotCreateCalls.push(b);
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
      if (method === 'PUT' && /\/lots\/\d+$/.test(url)) {
        const id = Number(url.split('/').at(-1));
        const lot = lots.find((candidate) => candidate.id === id);
        if (!lot) return Promise.resolve(jsonResponse({}, { status: 404 }));
        const b = body();
        lot.lot_number = b['lot_number'] as string;
        lot.manufacturing_date = (b['manufacturing_date'] as string | null) ?? null;
        lot.expiration_date = (b['expiration_date'] as string | null) ?? null;
        lot.supplier_id = (b['supplier_id'] as number | null) ?? null;
        return Promise.resolve(jsonResponse(lot));
      }
      if (method === 'PUT' && /\/lots\/\d+\/stock$/.test(url)) {
        const id = Number(url.split('/').at(-2));
        const b = body();
        lotStockSetCalls.push(b);
        const balance = balances.find((candidate) => candidate.lot.id === id);
        if (!balance) return Promise.resolve(jsonResponse({}, { status: 404 }));
        const previousQuantity = balance.quantity;
        balance.quantity = b['quantity'] as string;
        return Promise.resolve(
          jsonResponse({
            previous_quantity: previousQuantity,
            quantity: balance.quantity,
            adjustment_quantity: '0',
            movement_id: 2,
          }),
        );
      }
      if (method === 'DELETE' && /\/lots\/\d+$/.test(url)) {
        const id = Number(url.split('/').at(-1));
        const index = lots.findIndex((candidate) => candidate.id === id);
        if (index >= 0) lots.splice(index, 1);
        return Promise.resolve(new Response(null, { status: 204 }));
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
        consumeKeys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
        if (failFirstConsume && consumeKeys.length === 1) {
          return Promise.reject(new TypeError('Connection lost after sending request'));
        }
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
  return { consumeKeys, lotCreateCalls, lotStockSetCalls };
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
    const { consumeKeys, lotCreateCalls } = stubBackend({ failFirstConsume: true });
    renderPage();

    await screen.findByText('Yogur natural');
    await userEvent.selectOptions(screen.getByLabelText('Producto'), '10');
    await screen.findByText('Este producto todavía no tiene lotes.');

    const form = screen.getByRole('button', { name: 'Crear lote' }).closest('form')!;
    await userEvent.type(within(form).getByLabelText('Nº de lote'), 'L2026-01');
    await userEvent.type(within(form).getByLabelText('Caducidad (opcional)'), '2026-09-01');
    await userEvent.selectOptions(within(form).getByLabelText('Proveedor (opcional)'), '1');
    await userEvent.clear(within(form).getByLabelText('Cantidad'));
    await userEvent.type(within(form).getByLabelText('Cantidad'), '10');
    await waitFor(() => expect(within(form).getByLabelText('Almacén')).toHaveValue('1'));
    await waitFor(() => expect(within(form).getByLabelText('Ubicación')).toHaveValue('1'));
    await userEvent.click(within(form).getByRole('button', { name: 'Crear lote' }));

    await screen.findAllByText('L2026-01');
    expect(screen.getAllByText('2026-09-01')).not.toHaveLength(0);
    expect(lotCreateCalls).toEqual([
      expect.objectContaining({
        opening_stock: { warehouse_id: 1, location_id: 1, quantity: '10' },
      }),
    ]);

    // Saldo por lote + plan FEFO
    const fefoPanel = screen.getByRole('heading', { name: 'Saldo por lote y FEFO' }).parentElement!;
    await waitFor(() => expect(within(fefoPanel).getByLabelText('Almacén')).toHaveValue('1'));
    await waitFor(() => expect(within(fefoPanel).getByLabelText('Ubicación')).toHaveValue('1'));
    // Aparece dos veces: en la tabla de lotes del producto y en el saldo
    // por lote del almacén/ubicación elegidos.
    await waitFor(() => expect(screen.getAllByText('L2026-01')).toHaveLength(2));

    await userEvent.type(screen.getByLabelText('Cantidad a sacar'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Ver plan' }));

    const fefoList = await screen.findByText(/Lote L2026-01 \(caduca 2026-09-01\)/);
    expect(within(fefoList.closest('ul')!).getByText(/Lote L2026-01/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar salida' }));
    await screen.findByText('No se ha podido consumir el stock.');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar salida' }));
    await waitFor(() => expect(consumeKeys).toHaveLength(2));
    expect(consumeKeys[0]).not.toBe('');
    expect(consumeKeys[1]).toBe(consumeKeys[0]);
    expect(await screen.findByText(/Lote L2026-01 \(caduca 2026-09-01\)/)).toBeInTheDocument();
  });

  it('edits and deletes a lot that has not yet had stock recorded', async () => {
    stubBackend();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    await screen.findByText('Yogur natural');
    await userEvent.selectOptions(screen.getByLabelText('Producto'), '10');
    const form = screen.getByRole('button', { name: 'Crear lote' }).closest('form')!;
    await userEvent.type(within(form).getByLabelText('Nº de lote'), 'L-ORIGINAL');
    await userEvent.click(within(form).getByRole('button', { name: 'Crear lote' }));

    await screen.findAllByText('L-ORIGINAL');
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const lotNumber = within(screen.getAllByRole('table')[0]).getByLabelText('Nº de lote');
    await userEvent.clear(lotNumber);
    await userEvent.type(lotNumber, 'L-CORREGIDO');
    await userEvent.type(screen.getByLabelText('Caducidad'), '2026-12-31');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    const lotsTable = screen.getAllByRole('table')[0];
    expect(await within(lotsTable).findByText('L-CORREGIDO')).toBeInTheDocument();
    expect(within(lotsTable).getByText('2026-12-31')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    await screen.findByText('Este producto todavía no tiene lotes.');
  });

  it('corrects a lot balance from the counted physical quantity', async () => {
    const { lotStockSetCalls } = stubBackend();
    renderPage();

    await screen.findByText('Yogur natural');
    await userEvent.selectOptions(screen.getByLabelText('Producto'), '10');
    const form = screen.getByRole('button', { name: 'Crear lote' }).closest('form')!;
    await userEvent.type(within(form).getByLabelText('Nº de lote'), 'L-RECUENTO');
    await userEvent.click(within(form).getByRole('button', { name: 'Crear lote' }));

    const panel = screen.getByRole('heading', { name: 'Saldo por lote y FEFO' }).parentElement!;
    await userEvent.selectOptions(within(panel).getByLabelText('Almacén'), '1');
    await userEvent.selectOptions(within(panel).getByLabelText('Ubicación'), '1');
    await userEvent.click(await within(panel).findByRole('button', { name: 'Corregir cantidad' }));
    const count = within(panel).getByLabelText('Cantidad física del lote L-RECUENTO');
    await userEvent.clear(count);
    await userEvent.type(count, '4');
    await userEvent.type(
      within(panel).getByLabelText('Motivo de la corrección'),
      'Recuento inicial',
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(lotStockSetCalls).toEqual([
        expect.objectContaining({
          warehouse_id: 1,
          location_id: 1,
          quantity: '4',
          reason: 'Recuento inicial',
        }),
      ]),
    );
  });
});
