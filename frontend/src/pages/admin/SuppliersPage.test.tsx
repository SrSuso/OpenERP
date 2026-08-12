import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';
import { type Product } from '@/features/catalog/api';
import { type ProductSupplier, type Supplier } from '@/features/suppliers/api';

import { SuppliersPage } from './SuppliersPage';

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
  permissions: ['admin.access', 'supplier.read', 'supplier.manage'],
};

function stubBackend() {
  const suppliers: Supplier[] = [
    {
      id: 1,
      name: 'Distribuciones Ejemplo SL',
      tax_id: 'B12345678',
      email: 'ventas@ejemplo.test',
      phone: '600111222',
      address: '',
      is_active: true,
    },
  ];
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
    taxes: [],
    price_formula: null,
    min_stock: '0',
    track_lots: false,
    track_expiration: false,
    tracks_stock: null,
    effective_tracks_stock: true,
    is_active: true,
    packages: [],
  };
  const links: ProductSupplier[] = [];
  const createCalls: Record<string, unknown>[] = [];
  const deactivateCalls: number[] = [];
  const linkCalls: { productId: number; supplierId: number; body: Record<string, unknown> }[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));

      if (method === 'GET' && /\/suppliers\?/.test(url)) {
        const activeOnly = !url.includes('active_only=false');
        return Promise.resolve(
          jsonResponse(activeOnly ? suppliers.filter((s) => s.is_active) : suppliers),
        );
      }
      if (method === 'POST' && /\/suppliers$/.test(url)) {
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
        createCalls.push(body);
        const created: Supplier = {
          id: 2,
          name: body['name'] as string,
          tax_id: (body['tax_id'] as string | null) ?? null,
          email: (body['email'] as string | null) ?? null,
          phone: (body['phone'] as string | null) ?? null,
          address: (body['address'] as string) ?? '',
          is_active: true,
        };
        suppliers.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      if (method === 'POST' && /\/suppliers\/(\d+)\/deactivate$/.test(url)) {
        const id = Number(/\/suppliers\/(\d+)\/deactivate$/.exec(url)![1]);
        deactivateCalls.push(id);
        const supplier = suppliers.find((s) => s.id === id)!;
        supplier.is_active = false;
        return Promise.resolve(jsonResponse(supplier));
      }
      if (method === 'GET' && /\/suppliers\/(\d+)\/products$/.test(url)) {
        return Promise.resolve(jsonResponse(links));
      }
      if (method === 'GET' && /\/products\?/.test(url)) {
        return Promise.resolve(jsonResponse([product]));
      }
      if (method === 'PUT' && /\/products\/(\d+)\/suppliers\/(\d+)$/.test(url)) {
        const match = /\/products\/(\d+)\/suppliers\/(\d+)$/.exec(url)!;
        const productId = Number(match[1]);
        const supplierId = Number(match[2]);
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
        linkCalls.push({ productId, supplierId, body });
        const created: ProductSupplier = {
          id: 1,
          product_id: productId,
          product_sku: product.sku,
          product_name: product.name,
          supplier_id: supplierId,
          supplier_name: suppliers.find((s) => s.id === supplierId)!.name,
          supplier_sku: (body['supplier_sku'] as string | null) ?? null,
          supplier_cost: body['supplier_cost'] as string,
          is_preferred: body['is_preferred'] as boolean,
        };
        links.push(created);
        return Promise.resolve(jsonResponse(created));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { createCalls, deactivateCalls, linkCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SuppliersPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('SuppliersPage', () => {
  it('lists suppliers', async () => {
    stubBackend();
    renderPage();

    expect(await screen.findByText('Distribuciones Ejemplo SL')).toBeInTheDocument();
    expect(screen.getByText('B12345678')).toBeInTheDocument();
  });

  it('creates a supplier', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Distribuciones Ejemplo SL');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo proveedor' }));
    await userEvent.type(screen.getAllByLabelText('Nombre')[0]!, 'Otro Proveedor SA');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    expect(await screen.findByText('Otro Proveedor SA')).toBeInTheDocument();
    expect(backend.createCalls).toEqual([
      { name: 'Otro Proveedor SA', tax_id: null, email: null, phone: null, address: '' },
    ]);
  });

  it('deactivates a supplier', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Distribuciones Ejemplo SL');

    // El listado por defecto sólo trae activos — hay que pedir también
    // los inactivos para poder comprobar el nuevo estado tras desactivar.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Incluir inactivos' }));
    await screen.findByText('Distribuciones Ejemplo SL');
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));

    expect(await screen.findByText('Inactivo')).toBeInTheDocument();
    expect(backend.deactivateCalls).toEqual([1]);
  });

  it('links a product to a supplier', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Distribuciones Ejemplo SL');

    await userEvent.click(screen.getByRole('button', { name: 'Productos' }));
    await screen.findByText('Este proveedor no tiene productos vinculados.');

    await userEvent.selectOptions(screen.getByLabelText('Producto'), '10');
    const costInput = screen.getByLabelText('Coste');
    await userEvent.clear(costInput);
    await userEvent.type(costInput, '0.45');
    await userEvent.click(screen.getByRole('button', { name: 'Vincular' }));

    expect(await screen.findByText('Agua 1.5L')).toBeInTheDocument();
    expect(backend.linkCalls).toEqual([
      {
        productId: 10,
        supplierId: 1,
        body: { supplier_sku: null, supplier_cost: '0.45', is_preferred: false },
      },
    ]);
  });
});
