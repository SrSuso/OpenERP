import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
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
  permissions: [
    'admin.access',
    'product.read',
    'product.manage',
    'pricing.manage',
    'inventory.read',
  ],
};

const TAXES: Tax[] = [
  { id: 1, name: 'IVA general', rate: '21', surcharge_rate: '0', is_active: true },
];
// La categoría ya trae un impuesto propio — así una prueba puede comprobar
// que se muestra heredado (marcado) al elegirla, sin tocar nada más.
const CATEGORIES: ProductCategory[] = [
  { id: 1, name: 'Bebidas', is_active: true, margin_rate: '30', taxes: [TAXES[0]!] },
];
const POS_CATEGORIES: PosCategory[] = [
  { id: 1, name: 'Ofertas', color: '#64748b', display_order: 0, is_active: true },
];
const UNITS: Unit[] = [
  { id: 1, name: 'UNIT', display_order: 0 },
  { id: 2, name: 'KG', display_order: 1 },
];

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
    effective_tax_rate: '0.000000',
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
  const activateCalls: number[] = [];
  const pricingCalls: { id: number; body: Record<string, unknown> }[] = [];
  const manualPriceCalls: { id: number; listPrice: string }[] = [];
  const updateCalls: { id: number; body: Record<string, unknown> }[] = [];

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
      if (method === 'GET' && url.includes('/stock-balance/totals')) {
        return Promise.resolve(
          jsonResponse([
            { product_id: 1, quantity: '24.000000' },
            { product_id: 2, quantity: '14.500000' },
          ]),
        );
      }
      if (method === 'GET' && url.includes('/settings/values')) {
        return Promise.resolve(jsonResponse({ 'catalog.quick_price_units': 'KG' }));
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
      if (method === 'POST' && /\/products\/(\d+)\/activate$/.test(url)) {
        const id = Number(/\/products\/(\d+)\/activate$/.exec(url)![1]);
        activateCalls.push(id);
        const product = products.find((p) => p.id === id)!;
        product.is_active = true;
        return Promise.resolve(jsonResponse(product));
      }
      if (method === 'PUT' && /\/products\/(\d+)\/pricing\/manual-price$/.test(url)) {
        const id = Number(/\/products\/(\d+)\/pricing\/manual-price$/.exec(url)![1]);
        const body = init?.body
          ? (JSON.parse(init.body as string) as { list_price: string })
          : { list_price: '' };
        manualPriceCalls.push({ id, listPrice: body.list_price });
        const product = products.find((p) => p.id === id)!;
        product.list_price = `${Number(body.list_price).toFixed(6)}`;
        return Promise.resolve(jsonResponse(product));
      }
      if (method === 'PATCH' && /\/products\/(\d+)$/.test(url)) {
        const id = Number(/\/products\/(\d+)$/.exec(url)![1]);
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
        updateCalls.push({ id, body });
        const product = products.find((p) => p.id === id)!;
        if ('pos_category_id' in body) {
          const posId = body['pos_category_id'] as number | null;
          product.pos_category_id = posId;
          product.pos_category_name = POS_CATEGORIES.find((c) => c.id === posId)?.name ?? null;
        }
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

  return {
    createCalls,
    deactivateCalls,
    activateCalls,
    pricingCalls,
    manualPriceCalls,
    updateCalls,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/inventory/products']}>
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
    // El SKU es una referencia interna: ya no se enseña en la lista.
    expect(screen.queryByText('P000001')).not.toBeInTheDocument();
    // Cuánto hay de cada uno, sin tener que ir a Saldos.
    expect(await screen.findByText('24')).toBeInTheDocument();

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

  it('shows the category-inherited taxes pre-checked when creating, without sending them', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    await userEvent.selectOptions(screen.getByLabelText('Categoría (estantería)'), '1');

    expect(screen.getByRole('button', { name: /IVA general/, pressed: true })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Nombre'), 'Sin tocar impuestos');
    await userEvent.selectOptions(screen.getByLabelText('Unidad base'), 'UNIT');
    const price = screen.getByLabelText('Precio de venta');
    await userEvent.clear(price);
    await userEvent.type(price, '1');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await screen.findByText('Sin tocar impuestos');
    // Sigue heredando: no hay PATCH .../pricing de más, igual que si no
    // hubiese categoría con impuestos.
    expect(backend.pricingCalls).toEqual([]);
  });

  it('assigns a product to a POS category from the list itself', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    // Sin categoría POS de partida, que es como nace un producto.
    const picker = screen.getByLabelText('Categoría POS de Agua 1L');
    expect(picker).toHaveValue('');

    await userEvent.selectOptions(picker, '1');

    expect(backend.updateCalls).toEqual([{ id: 1, body: { pos_category_id: 1 } }]);

    // Y se puede sacar de todos los botones del TPV.
    await userEvent.selectOptions(await screen.findByLabelText('Categoría POS de Agua 1L'), '');
    expect(backend.updateCalls.at(-1)).toEqual({ id: 1, body: { pos_category_id: null } });
  });

  it('narrows the list to the products still missing a POS category', async () => {
    stubBackend({
      products: [
        baseProduct(),
        {
          ...baseProduct(),
          id: 2,
          sku: 'P000002',
          name: 'Tomate',
          pos_category_id: 1,
          pos_category_name: 'Ofertas',
        },
      ],
    });
    renderPage();
    await screen.findByText('Tomate');

    await userEvent.selectOptions(screen.getByLabelText('Categoría POS'), 'none');

    expect(screen.getByText('Agua 1L')).toBeInTheDocument();
    expect(screen.queryByText('Tomate')).not.toBeInTheDocument();
  });

  it('opens the product detail from its own name', async () => {
    stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    expect(screen.getByRole('link', { name: 'Agua 1L' })).toHaveAttribute(
      'href',
      '/admin/inventory/products/1',
    );
  });

  it('does not offer to create a product without product.manage, but the detail link stays', async () => {
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
        if (url.includes('/settings/values')) return Promise.resolve(jsonResponse({}));
        if (url.includes('/stock-balance/totals')) return Promise.resolve(jsonResponse([]));
        if (url.includes('/units')) return Promise.resolve(jsonResponse(UNITS));
        if (url.includes('/taxes')) return Promise.resolve(jsonResponse(TAXES));
        if (url.includes('/products?')) return Promise.resolve(jsonResponse([baseProduct()]));
        return Promise.reject(new Error(`Unexpected fetch to ${url} in test`));
      }),
    );
    renderPage();

    await screen.findByText('Agua 1L');

    expect(screen.queryByRole('button', { name: 'Nuevo producto' })).not.toBeInTheDocument();
    // Se puede seguir mirando la ficha, que es de sólo lectura sin permisos.
    expect(screen.getByRole('link', { name: 'Agua 1L' })).toBeInTheDocument();
    // Sin pricing.manage el precio se ve, pero no se teclea.
    expect(screen.queryByLabelText('Precio de Agua 1L')).not.toBeInTheDocument();
  });

  it('only the products sold by weight get the price editable in the row', async () => {
    const backend = stubBackend({
      products: [
        baseProduct(),
        { ...baseProduct(), id: 2, sku: 'P000002', name: 'Tomate', base_unit_name: 'KG' },
      ],
    });
    renderPage();
    await screen.findByText('Tomate');

    // "Agua 1L" se vende por unidades: su precio se ve, no se teclea.
    expect(screen.queryByLabelText('Precio de Agua 1L')).not.toBeInTheDocument();
    expect(screen.getByText('0,60 €')).toBeInTheDocument();

    const price = screen.getByLabelText('Precio de Tomate');
    await userEvent.clear(price);
    await userEvent.type(price, '1,68{Enter}');

    // No se guarda a la primera: el precio nuevo se aplica también a lo que
    // ya está en la estantería, así que avisa antes.
    const dialog = await screen.findByRole('dialog', { name: /cambiar el pvp de tomate/i });
    expect(backend.manualPriceCalls).toEqual([]);
    expect(within(dialog).getByText(/14,5 KG en almacén/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cambiar' }));

    expect(backend.manualPriceCalls).toEqual([{ id: 2, listPrice: '1.68' }]);
    expect(await screen.findByText('Guardado')).toBeInTheDocument();
  });

  it('filters the list by base unit', async () => {
    stubBackend({
      products: [
        baseProduct(),
        { ...baseProduct(), id: 2, sku: 'P000002', name: 'Tomate', base_unit_name: 'KG' },
      ],
    });
    renderPage();
    await screen.findByText('Tomate');

    await userEvent.selectOptions(screen.getByLabelText('Unidad'), 'KG');

    expect(screen.queryByText('Agua 1L')).not.toBeInTheDocument();
    expect(screen.getByText('€/KG')).toBeInTheDocument();
  });

  it('does not save a price that has not really changed', async () => {
    const backend = stubBackend({
      products: [{ ...baseProduct(), name: 'Tomate', base_unit_name: 'KG' }],
    });
    renderPage();
    await screen.findByText('Tomate');

    const price = screen.getByLabelText('Precio de Tomate');
    await userEvent.clear(price);
    // "0,60" es lo mismo que el "0.600000" guardado: no hay nada que guardar,
    // y una entrada de más en el histórico de precios sería ruido.
    await userEvent.type(price, '0,60{Enter}');

    expect(backend.manualPriceCalls).toEqual([]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
