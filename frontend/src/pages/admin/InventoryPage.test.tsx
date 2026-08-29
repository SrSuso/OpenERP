import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type Product } from '@/features/catalog/api';
import {
  type Location,
  type StockBalance,
  type StockMovement,
  type Warehouse,
} from '@/features/inventory/api';

import { InventoryBalancesPage } from './InventoryBalancesPage';
import { InventoryWarehousesPage } from './InventoryWarehousesPage';

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
  permissions: ['admin.access', 'inventory.read', 'inventory.manage'],
};

function stubBackend() {
  const warehouses: Warehouse[] = [{ id: 1, name: 'Almacén central', is_active: true }];
  const locations: Location[] = [{ id: 1, warehouse_id: 1, name: 'Recepción', is_active: true }];
  const product: Product = {
    id: 10,
    sku: 'P000010',
    name: 'Agua 1.5L',
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
    track_lots: false,
    track_expiration: false,
    tracks_stock: null,
    effective_tracks_stock: true,
    is_active: true,
    packages: [
      {
        id: 1,
        name: 'UNIT',
        factor: '1.000000',
        is_base: true,
        barcodes: [{ id: 1, barcode: '8412345678901' }],
      },
    ],
  };
  const balances: StockBalance[] = [
    {
      product_id: 10,
      product_sku: 'P000010',
      product_name: 'Agua 1.5L',
      warehouse_id: 1,
      warehouse_name: 'Almacén central',
      location_id: 1,
      location_name: 'Recepción',
      lot_id: null,
      quantity: '24',
    },
  ];
  const createWarehouseCalls: string[] = [];
  const createLocationCalls: { warehouseId: number; name: string }[] = [];
  const adjustmentCalls: Record<string, unknown>[] = [];
  const rebuildCalls: true[] = [];

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
      if (method === 'GET' && /\/warehouses$/.test(url))
        return Promise.resolve(jsonResponse(warehouses));
      if (method === 'POST' && /\/warehouses$/.test(url)) {
        const name = body()['name'] as string;
        createWarehouseCalls.push(name);
        const created: Warehouse = { id: 2, name, is_active: true };
        warehouses.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      const locMatch = /\/warehouses\/(\d+)\/locations$/.exec(url);
      if (method === 'GET' && locMatch) {
        return Promise.resolve(
          jsonResponse(locations.filter((l) => l.warehouse_id === Number(locMatch[1]))),
        );
      }
      if (method === 'POST' && locMatch) {
        const warehouseId = Number(locMatch[1]);
        const name = body()['name'] as string;
        createLocationCalls.push({ warehouseId, name });
        const created: Location = { id: 2, warehouse_id: warehouseId, name, is_active: true };
        locations.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      if (method === 'GET' && /\/stock-balance\?/.test(url)) {
        return Promise.resolve(jsonResponse(balances));
      }
      if (method === 'POST' && /\/stock-movements\/adjustments$/.test(url)) {
        const b = body();
        adjustmentCalls.push(b);
        const movement: StockMovement = {
          id: 1,
          product_id: b['product_id'] as number,
          product_sku: product.sku,
          product_name: product.name,
          warehouse_id: b['warehouse_id'] as number,
          location_id: b['location_id'] as number,
          lot_id: null,
          quantity: b['quantity'] as string,
          movement_type: b['movement_type'] as string,
          reference_type: null,
          reference_id: null,
          unit_cost: b['unit_cost'] as string,
          user_id: 1,
          created_at: new Date().toISOString(),
        };
        return Promise.resolve(jsonResponse(movement, { status: 201 }));
      }
      if (method === 'POST' && /\/stock-balance\/rebuild$/.test(url)) {
        rebuildCalls.push(true);
        return Promise.resolve(jsonResponse({ rows: balances.length }));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { createWarehouseCalls, createLocationCalls, adjustmentCalls, rebuildCalls };
}

function renderComponent(children: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>,
  );
}

describe('InventoryWarehousesPage', () => {
  it('creates a warehouse and a location', async () => {
    const backend = stubBackend();
    renderComponent(<InventoryWarehousesPage />);

    await screen.findByText('Almacén central');

    await userEvent.type(screen.getByPlaceholderText('Almacén central…'), 'Almacén norte');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir almacén' }));
    await screen.findByText('Almacén norte');
    expect(backend.createWarehouseCalls).toEqual(['Almacén norte']);

    await userEvent.click(screen.getAllByRole('button', { name: 'Ubicaciones' })[0]!);
    await screen.findByText('Recepción');

    await userEvent.type(screen.getByPlaceholderText('Recepción, Pasillo 1…'), 'Pasillo 2');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir ubicación' }));

    await screen.findByText('Pasillo 2');
    expect(backend.createLocationCalls).toEqual([{ warehouseId: 1, name: 'Pasillo 2' }]);
  });
});

describe('InventoryBalancesPage', () => {
  it('lists stock balances and records an adjustment', async () => {
    const backend = stubBackend();
    renderComponent(<InventoryBalancesPage />);

    // La tabla identifica el producto por su nombre, no por el SKU.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Agua 1.5L')).toBeInTheDocument();
    expect(within(table).queryByText('P000010')).not.toBeInTheDocument();
    expect(within(table).getByText('24')).toBeInTheDocument();
    // Almacén y ubicación por su nombre, no por su id.
    expect(within(table).getByText('Almacén central')).toBeInTheDocument();
    expect(within(table).getByText('Recepción')).toBeInTheDocument();

    // Y la lista se puede acotar a un producto buscándolo por su código de
    // barras, con el producto en la mano.
    const filters = screen.getByLabelText('Buscar producto');
    await userEvent.type(filters, '8412345678901');
    const productFilter = screen.getByLabelText('Producto');
    expect(productFilter).toHaveValue('');
    await userEvent.selectOptions(productFilter, '10');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo ajuste' }));
    const form = screen.getByRole('heading', { name: 'Registrar ajuste' }).closest('form')!;
    // Buscar por código sólo filtra: aun con una coincidencia hay que
    // confirmarla desde el desplegable, igual que en el resto de buscadores.
    await userEvent.type(within(form).getByLabelText('Buscar producto'), '8412345678901');
    const productSelect = within(form).getByLabelText('Producto');
    expect(productSelect).toHaveValue('');
    await userEvent.selectOptions(productSelect, '10');
    // Almacén y ubicación vienen ya con la primera opción puesta: con un solo
    // almacén no hay nada que elegir, y desplegarlos era un paso de más. El
    // coste se rellena con el que tiene ahora el producto (0,50), sin dejar
    // de poder cambiarse.
    await waitFor(() => {
      expect(within(form).getByLabelText('Almacén')).toHaveValue('1');
      expect(within(form).getByLabelText('Ubicación')).toHaveValue('1');
      expect(within(form).getByLabelText('Coste/ud.')).toHaveValue('0,5');
      // Al lado, el PVP del producto, sólo para mirarlo.
      expect(within(form).getByLabelText('PVP/ud.')).toHaveValue('1');
    });
    await userEvent.type(within(form).getByLabelText('Cantidad (con signo)'), '-2');
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar ajuste' }));

    expect(backend.adjustmentCalls).toEqual([
      {
        product_id: 10,
        warehouse_id: 1,
        location_id: 1,
        movement_type: 'ADJUSTMENT',
        quantity: '-2',
        unit_cost: '0.5',
        lot_id: null,
        reason: '',
      },
    ]);
  });

  it('rebuilds the stock balance projection after confirming', async () => {
    const backend = stubBackend();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderComponent(<InventoryBalancesPage />);

    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Reconstruir inventario' }));

    expect(confirmSpy).toHaveBeenCalled();
    await screen.findByText(/Inventario reconstruido: 1 saldos recalculados\./);
    expect(backend.rebuildCalls).toEqual([true]);
  });

  it('does nothing when the rebuild confirmation is cancelled', async () => {
    const backend = stubBackend();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderComponent(<InventoryBalancesPage />);

    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Reconstruir inventario' }));

    expect(backend.rebuildCalls).toEqual([]);
  });
});
