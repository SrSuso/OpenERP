import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';
import {
  type PosCategory,
  type Product,
  type ProductCategory,
  type Unit,
} from '@/features/catalog/api';
import { type Tax } from '@/features/pricing/api';

import { ProductsPage } from './ProductsPage';

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
  permissions: ['admin.access', 'product.read', 'product.manage', 'pricing.manage'],
};

const CATEGORIES: ProductCategory[] = [
  { id: 1, name: 'Bebidas', is_active: true, margin_rate: '30', taxes: [] },
];
const POS_CATEGORIES: PosCategory[] = [
  { id: 1, name: 'Ofertas', color: '#64748b', display_order: 0, is_active: true },
];
const UNITS: Unit[] = [{ id: 1, name: 'UNIT' }];
const TAXES: Tax[] = [{ id: 1, name: 'IVA general', rate: '21', is_active: true }];

function baseProduct(): Product {
  return {
    id: 1,
    sku: 'P000001',
    name: 'Agua 1L',
    description: '',
    category_id: 1,
    category_name: 'Bebidas',
    pos_category_id: null,
    pos_category_name: null,
    pos_display_order: 0,
    base_unit_name: 'UNIT',
    cost: '0.300000',
    list_price: '0.600000',
    tax_rate: '0.000000',
    surcharge_rate: '0.000000',
    margin_rate: null,
    taxes: [],
    price_formula: null,
    min_stock: '10.000000',
    track_lots: false,
    track_expiration: false,
    is_active: true,
    packages: [{ id: 1, name: 'UNIT', factor: '1.000000', is_base: true, barcodes: [] }],
  };
}

function stubBackend(options: { products?: Product[] } = {}) {
  const products: Product[] = options.products ?? [baseProduct()];
  const createCalls: Record<string, unknown>[] = [];
  const updateCalls: { id: number; body: Record<string, unknown> }[] = [];
  const deactivateCalls: number[] = [];
  const addPackageCalls: { productId: number; body: Record<string, unknown> }[] = [];
  const pricingCalls: { id: number; body: Record<string, unknown> }[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (method === 'GET' && url.includes('/product-categories')) {
        return Promise.resolve(jsonResponse(CATEGORIES));
      }
      if (method === 'GET' && url.includes('/pos-categories')) {
        return Promise.resolve(jsonResponse(POS_CATEGORIES));
      }
      if (method === 'GET' && url.includes('/units')) {
        return Promise.resolve(jsonResponse(UNITS));
      }
      if (method === 'GET' && url.includes('/taxes')) {
        return Promise.resolve(jsonResponse(TAXES));
      }
      if (method === 'POST' && url.includes('/pricing/preview')) {
        return Promise.resolve(jsonResponse({ result: '1.000000' }));
      }
      if (method === 'GET' && url.includes('/products?')) {
        return Promise.resolve(jsonResponse(products));
      }
      if (method === 'POST' && /\/products$/.test(url.split('?')[0]!)) {
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
        createCalls.push(body);
        const created: Product = {
          ...baseProduct(),
          id: 99,
          sku: 'P000099',
          name: body['name'] as string,
          packages: [
            {
              id: 2,
              name: body['base_unit_name'] as string,
              factor: '1.000000',
              is_base: true,
              barcodes: [],
            },
          ],
        };
        products.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      if (method === 'PATCH' && /\/products\/(\d+)$/.test(url)) {
        const id = Number(/\/products\/(\d+)$/.exec(url)![1]);
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
        updateCalls.push({ id, body });
        const product = products.find((p) => p.id === id)!;
        Object.assign(product, body);
        return Promise.resolve(jsonResponse(product));
      }
      if (method === 'POST' && /\/products\/(\d+)\/deactivate$/.test(url)) {
        const id = Number(/\/products\/(\d+)\/deactivate$/.exec(url)![1]);
        deactivateCalls.push(id);
        const product = products.find((p) => p.id === id)!;
        product.is_active = false;
        return Promise.resolve(jsonResponse(product));
      }
      if (method === 'POST' && /\/products\/(\d+)\/packages$/.test(url)) {
        const id = Number(/\/products\/(\d+)\/packages$/.exec(url)![1]);
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
        addPackageCalls.push({ productId: id, body });
        const product = products.find((p) => p.id === id)!;
        product.packages.push({
          id: product.packages.length + 10,
          name: body['name'] as string,
          factor: body['factor'] as string,
          is_base: false,
          barcodes: body['barcode'] ? [body['barcode'] as string] : [],
        });
        return Promise.resolve(jsonResponse(product));
      }
      if (method === 'PATCH' && /\/products\/(\d+)\/pricing$/.test(url)) {
        const id = Number(/\/products\/(\d+)\/pricing$/.exec(url)![1]);
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
        pricingCalls.push({ id, body });
        const product = products.find((p) => p.id === id)!;
        if ('cost' in body) product.cost = body['cost'] as string;
        if ('margin_rate' in body) product.margin_rate = body['margin_rate'] as string | null;
        if ('tax_ids' in body) {
          const ids = body['tax_ids'] as number[];
          product.taxes = TAXES.filter((t) => ids.includes(t.id));
        }
        product.list_price = '9.990000';
        return Promise.resolve(jsonResponse(product));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { createCalls, updateCalls, deactivateCalls, addPackageCalls, pricingCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ProductsPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('ProductsPage', () => {
  it('lists the existing products, no SKU field to fill in when creating', async () => {
    stubBackend();
    renderPage();

    expect(await screen.findByText('Agua 1L')).toBeInTheDocument();
    expect(screen.getByText('P000001')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    expect(screen.queryByLabelText('SKU')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^IVA/)).not.toBeInTheDocument();
  });

  it('creates a product picking the unit from the dropdown', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Refresco 33cl');
    await userEvent.selectOptions(screen.getByLabelText('Unidad base'), 'UNIT');
    const cost = screen.getByLabelText('Coste');
    await userEvent.clear(cost);
    await userEvent.type(cost, '0.5');
    const price = screen.getByLabelText('Precio de venta');
    await userEvent.clear(price);
    await userEvent.type(price, '1');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    expect(await screen.findByText('Refresco 33cl')).toBeInTheDocument();
    expect(backend.createCalls).toHaveLength(1);
    expect(backend.createCalls[0]).toMatchObject({
      name: 'Refresco 33cl',
      base_unit_name: 'UNIT',
      cost: '0.5',
      list_price: '1',
      margin_rate: null,
    });
    expect(backend.createCalls[0]).not.toHaveProperty('sku');
    expect(backend.createCalls[0]).not.toHaveProperty('tax_rate');
  });

  it('edits a product (catalog-only fields)', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const nameInput = screen.getByDisplayValue('Agua 1L');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Agua mineral 1L');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Agua mineral 1L')).toBeInTheDocument();
    expect(backend.updateCalls).toHaveLength(1);
    expect(backend.updateCalls[0]!.body).toMatchObject({ name: 'Agua mineral 1L' });
  });

  it('deactivates a product', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));

    await screen.findByText('Inactivo');
    expect(backend.deactivateCalls).toEqual([1]);
  });

  it('adds a package (presentación) from the expanded row', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    await userEvent.click(screen.getByRole('button', { name: 'Presentaciones' }));
    await userEvent.type(screen.getByLabelText('Nueva presentación'), 'PACK 6');
    await userEvent.type(screen.getByLabelText('Factor'), '6');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir presentación' }));

    await screen.findByText('PACK 6');
    expect(backend.addPackageCalls).toEqual([
      { productId: 1, body: { name: 'PACK 6', factor: '6', barcode: null } },
    ]);
  });

  it('sets a product-level margin and tax override from the Precio panel', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    await userEvent.click(screen.getByRole('button', { name: 'Precio' }));
    const marginInput = screen.getByPlaceholderText('heredado: 30%');
    await userEvent.type(marginInput, '15');
    await userEvent.click(screen.getByRole('checkbox', { name: /IVA general/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar precio' }));

    // El nuevo PVP aparece tanto en la columna "Precio" de la fila como en
    // "PVP actual" del propio panel — findAllByText en vez de findByText,
    // que exige un único nodo.
    expect(await screen.findAllByText('9,99 €')).not.toHaveLength(0);
    expect(backend.pricingCalls).toEqual([
      { id: 1, body: { cost: '0.300000', margin_rate: '15', tax_ids: [1] } },
    ]);
  });

  it('does not offer to create/edit/deactivate/price without product.manage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/auth/me')) {
          return Promise.resolve(
            jsonResponse({ ...ME, permissions: ['admin.access', 'product.read'] }),
          );
        }
        if (url.includes('/product-categories')) return Promise.resolve(jsonResponse(CATEGORIES));
        if (url.includes('/pos-categories')) return Promise.resolve(jsonResponse(POS_CATEGORIES));
        if (url.includes('/units')) return Promise.resolve(jsonResponse(UNITS));
        if (url.includes('/taxes')) return Promise.resolve(jsonResponse(TAXES));
        if (url.includes('/products?')) return Promise.resolve(jsonResponse([baseProduct()]));
        return Promise.reject(new Error(`Unexpected fetch to ${url} in test`));
      }),
    );
    renderPage();

    await screen.findByText('Agua 1L');

    expect(screen.queryByRole('button', { name: 'Nuevo producto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Precio' })).not.toBeInTheDocument();
  });
});
