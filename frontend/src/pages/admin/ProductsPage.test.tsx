import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
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
const UNITS: Unit[] = [{ id: 1, name: 'UNIT', display_order: 0 }];
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
  const deactivateCalls: number[] = [];
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
      if (method === 'POST' && /\/products\/(\d+)\/deactivate$/.test(url)) {
        const id = Number(/\/products\/(\d+)\/deactivate$/.exec(url)![1]);
        deactivateCalls.push(id);
        const product = products.find((p) => p.id === id)!;
        product.is_active = false;
        return Promise.resolve(jsonResponse(product));
      }
      if (method === 'PATCH' && /\/products\/(\d+)\/pricing$/.test(url)) {
        const id = Number(/\/products\/(\d+)\/pricing$/.exec(url)![1]);
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
        pricingCalls.push({ id, body });
        const product = products.find((p) => p.id === id)!;
        if ('tax_ids' in body) {
          const ids = body['tax_ids'] as number[];
          product.taxes = TAXES.filter((t) => ids.includes(t.id));
        }
        return Promise.resolve(jsonResponse(product));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { createCalls, deactivateCalls, pricingCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/catalog/products']}>
          <ProductsPage />
        </MemoryRouter>
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
    // Sin ningún impuesto elegido, no hay PATCH .../pricing de más.
    expect(backend.pricingCalls).toEqual([]);
  });

  it('assigns the chosen taxes right after creating the product', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Con IVA');
    await userEvent.selectOptions(screen.getByLabelText('Unidad base'), 'UNIT');
    const price = screen.getByLabelText('Precio de venta');
    await userEvent.clear(price);
    await userEvent.type(price, '1');
    await userEvent.click(screen.getByRole('button', { name: /IVA general/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await screen.findByText('Con IVA');
    expect(backend.pricingCalls).toEqual([{ id: 99, body: { tax_ids: [1] } }]);
  });

  it('links each row to its product detail page instead of editing inline', async () => {
    stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    expect(screen.getByRole('link', { name: 'Ver ficha' })).toHaveAttribute(
      'href',
      '/admin/catalog/products/1',
    );
  });

  it('deactivates a product', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));

    await screen.findByText('Inactivo');
    expect(backend.deactivateCalls).toEqual([1]);
  });

  it('does not offer to create/deactivate a product without product.manage, but the detail link stays', async () => {
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
    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver ficha' })).toBeInTheDocument();
  });
});
