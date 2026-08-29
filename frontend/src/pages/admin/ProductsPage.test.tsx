import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
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
    'inventory.manage',
  ],
};

const TAXES: Tax[] = [
  { id: 1, name: 'IVA general', rate: '21', surcharge_rate: '5.2', is_active: true },
];
// La categoría ya trae un impuesto propio — así una prueba puede comprobar
// que se muestra heredado (marcado) al elegirla, sin tocar nada más.
const CATEGORIES: ProductCategory[] = [
  {
    id: 1,
    name: 'Bebidas',
    is_active: true,
    margin_rate: '30',
    margin_amount: null,
    price_formula: null,
    tracks_stock: true,
    default_unit_name: 'KG',
    taxes: [TAXES[0]!],
  },
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
    margin_amount: null,
    taxes: [],
    price_formula: null,
    min_stock: '10.000000',
    track_lots: false,
    track_expiration: false,
    tracks_stock: null,
    effective_tracks_stock: true,
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
  const previewCalls: Record<string, unknown>[] = [];
  const manualPriceCalls: { id: number; listPrice: string }[] = [];

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
      if (method === 'GET' && /\/warehouses\/?$/.test(url.split('?')[0]!)) {
        return Promise.resolve(
          jsonResponse([{ id: 1, name: 'Tienda principal', is_active: true }]),
        );
      }
      if (method === 'GET' && /\/warehouses\/1\/locations$/.test(url.split('?')[0]!)) {
        return Promise.resolve(
          jsonResponse([{ id: 1, warehouse_id: 1, name: 'Almacén', is_active: true }]),
        );
      }
      if (method === 'GET' && url.includes('/units')) {
        return Promise.resolve(jsonResponse(UNITS));
      }
      if (method === 'GET' && url.includes('/taxes')) {
        return Promise.resolve(jsonResponse(TAXES));
      }
      if (method === 'POST' && url.includes('/pricing/preview')) {
        previewCalls.push(
          init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {},
        );
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
      if (method === 'PATCH' && /\/products\/(\d+)\/pricing$/.test(url)) {
        const id = Number(/\/products\/(\d+)\/pricing$/.exec(url)![1]);
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
        pricingCalls.push({ id, body });
        const product = products.find((p) => p.id === id)!;
        if ('tax_ids' in body) {
          const ids = body['tax_ids'] as number[];
          product.taxes = TAXES.filter((t) => ids.includes(t.id));
        }
        if ('cost' in body) {
          product.cost = `${Number(body['cost']).toFixed(6)}`;
          // Como el backend: cambiar el coste recalcula el PVP con el
          // margen heredado de "Bebidas" (30%). No se teclea.
          product.list_price = `${(Number(body['cost']) * 1.3).toFixed(6)}`;
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
    previewCalls,
    manualPriceCalls,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/admin/inventory/products', element: <ProductsPage /> },
      { path: '/admin/another-page', element: <p>Otra página</p> },
      { path: '/admin/inventory/products/:productId', element: <p>Ficha de producto</p> },
    ],
    { initialEntries: ['/admin/inventory/products'] },
  );
  return {
    router,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>,
    ),
  };
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

  it('asks before leaving the product creation form with unsaved changes', async () => {
    stubBackend();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { router } = renderPage();
    await screen.findByText('Agua 1L');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Producto pendiente');
    await act(async () => {
      await router.navigate('/admin/another-page');
    });

    await waitFor(() =>
      expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('no has guardado')),
    );
    expect(screen.getByDisplayValue('Producto pendiente')).toBeInTheDocument();
  });

  it('includes the selected IVA equivalence surcharge in a category-free product preview', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Producto suelto');
    await userEvent.selectOptions(screen.getByLabelText('Unidad base'), 'UNIT');
    await userEvent.clear(screen.getByLabelText('Coste'));
    await userEvent.type(screen.getByLabelText('Coste'), '10');
    await userEvent.click(screen.getByRole('button', { name: /IVA general/ }));

    await waitFor(() =>
      expect(backend.previewCalls).toContainEqual(
        expect.objectContaining({ tax_rate: '21', surcharge_rate: '5.2' }),
      ),
    );
  });

  it('records opening stock in the selected inventory location with the new product', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Galletas');
    await userEvent.selectOptions(screen.getByLabelText('Unidad base'), 'UNIT');
    await userEvent.clear(screen.getByLabelText('Precio de venta'));
    await userEvent.type(screen.getByLabelText('Precio de venta'), '2');
    await userEvent.clear(screen.getByLabelText('Cantidad'));
    await userEvent.type(screen.getByLabelText('Cantidad'), '18');
    await screen.findByRole('option', { name: 'Tienda principal' });
    await userEvent.selectOptions(screen.getByLabelText('Almacén'), '1');
    await screen.findByRole('option', { name: 'Almacén' });
    await userEvent.selectOptions(screen.getByLabelText('Ubicación'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    expect(await screen.findByText('Galletas')).toBeInTheDocument();
    expect(backend.createCalls[0]).toMatchObject({
      name: 'Galletas',
      initial_stock: { warehouse_id: 1, location_id: 1, quantity: '18' },
    });
  });

  it('uses one traceability option to enable both expiry dates and lots', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Yogur');
    await userEvent.selectOptions(screen.getByLabelText('Unidad base'), 'UNIT');
    await userEvent.click(screen.getByLabelText('Control de caducidad y lotes'));

    expect(screen.queryByLabelText('Controla lotes')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    expect(backend.createCalls[0]).toMatchObject({ track_lots: true, track_expiration: true });
  });

  it('records the printed lot with opening stock for a product with expiry', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Yogur con inventario');
    await userEvent.selectOptions(screen.getByLabelText('Unidad base'), 'UNIT');
    await userEvent.clear(screen.getByLabelText('Precio de venta'));
    await userEvent.type(screen.getByLabelText('Precio de venta'), '2');
    await userEvent.clear(screen.getByLabelText('Cantidad'));
    await userEvent.type(screen.getByLabelText('Cantidad'), '18');
    await userEvent.selectOptions(screen.getByLabelText('Almacén'), '1');
    await userEvent.selectOptions(screen.getByLabelText('Ubicación'), '1');
    await userEvent.click(screen.getByLabelText('Control de caducidad y lotes'));
    await userEvent.type(screen.getByLabelText('Lote inicial'), 'YOG-01');
    await userEvent.type(screen.getByLabelText('Caducidad'), '2030-01-31');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    expect(backend.createCalls[0]).toMatchObject({
      track_lots: true,
      track_expiration: true,
      initial_stock: {
        warehouse_id: 1,
        location_id: 1,
        quantity: '18',
        lot_number: 'YOG-01',
        expiration_date: '2030-01-31',
      },
    });
  });

  it('requires clicking Crear even when Enter is pressed in a valid new product form', async () => {
    const backend = stubBackend();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Agua 1L');

    await user.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    await user.type(screen.getByLabelText('Nombre'), 'Refresco 33cl');
    await user.selectOptions(screen.getByLabelText('Unidad base'), 'UNIT');
    const price = screen.getByLabelText('Precio de venta');
    await user.clear(price);
    await user.type(price, '1{Enter}');

    const barcode = screen.getByLabelText('Código de barras (opcional)');
    await user.type(barcode, '8412345678901{Enter}');

    expect(barcode).toHaveValue('8412345678901');
    expect(backend.createCalls).toEqual([]);
    expect(screen.getByRole('heading', { name: 'Nuevo producto' })).toBeInTheDocument();
  });

  it('creates a named open-price button for the POS', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Charcutería');
    await userEvent.selectOptions(screen.getByLabelText('Unidad base'), 'UNIT');
    await userEvent.click(screen.getByLabelText('Precio libre en TPV'));
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    expect(await screen.findByText('Charcutería')).toBeInTheDocument();
    expect(backend.createCalls[0]).toMatchObject({
      name: 'Charcutería',
      is_open_price: true,
    });
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

  it('uses the category default unit when that category is selected', async () => {
    stubBackend();
    renderPage();
    await screen.findByText('Agua 1L');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    await userEvent.selectOptions(screen.getByLabelText('Categoría (estantería)'), '1');

    expect(screen.getByLabelText('Unidad base')).toHaveValue('KG');
  });

  it('shows the POS category in the list without allowing it to be changed there', async () => {
    stubBackend({
      products: [
        {
          ...baseProduct(),
          pos_category_id: 1,
          pos_category_name: 'Ofertas',
        },
      ],
    });
    renderPage();
    await screen.findByText('Agua 1L');

    expect(screen.getAllByText('Ofertas')).not.toHaveLength(0);
    expect(screen.queryByLabelText('Categoría POS de Agua 1L')).not.toBeInTheDocument();
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
    expect(screen.queryByLabelText('PVP de venta de Agua 1L')).not.toBeInTheDocument();
    // Y el coste no se ve siquiera: lo que cuesta el género es cosa de
    // quien pone los precios, no de quien sólo mira el catálogo.
    expect(screen.queryByText('Coste (por unidad base)')).not.toBeInTheDocument();
    expect(screen.queryByText('0,30 €')).not.toBeInTheDocument();
  });

  it('only products marked as sold by weight get their selling PVP editable in the row', async () => {
    const backend = stubBackend({
      products: [
        baseProduct(),
        {
          ...baseProduct(),
          id: 2,
          sku: 'P000002',
          name: 'Tomate',
          base_unit_name: 'KG',
          is_sold_by_weight: true,
        },
      ],
    });
    renderPage();
    await screen.findByText('Tomate');

    // "Agua 1L" se vende por unidades: su precio se ve, no se teclea.
    expect(screen.queryByLabelText('PVP de venta de Agua 1L')).not.toBeInTheDocument();
    expect(screen.getByText('0,60 €')).toBeInTheDocument();

    const price = screen.getByLabelText('PVP de venta de Tomate');
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

  it('typing a new cost in the row recomputes the price from the margin', async () => {
    const backend = stubBackend({
      products: [
        {
          ...baseProduct(),
          id: 2,
          name: 'Tomate',
          base_unit_name: 'KG',
          cost: '1.000000',
          is_sold_by_weight: true,
        },
      ],
    });
    renderPage();
    await screen.findByText('Tomate');

    const cost = screen.getByLabelText('Coste de Tomate');
    await userEvent.clear(cost);
    await userEvent.type(cost, '2{Enter}');

    // Avisa igual que con el PVP: lo que ya está en la estantería pasa a
    // venderse al precio nuevo.
    const dialog = await screen.findByRole('dialog', { name: /cambiar el coste de tomate/i });
    expect(backend.pricingCalls).toEqual([]);
    expect(within(dialog).getByText(/El PVP se recalculará solo/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cambiar' }));

    // Y no se toca el PVP a mano: se pide que lo recalcule el margen.
    expect(backend.pricingCalls).toEqual([{ id: 2, body: { cost: '2' } }]);
    expect(backend.manualPriceCalls).toEqual([]);
    // 2 € de coste con el 30% de "Bebidas" = 2,60 € en la propia fila.
    expect(await screen.findByDisplayValue('2,6')).toBeInTheDocument();
  });

  it('says "sin control" instead of zero for what never runs out', async () => {
    stubBackend({
      products: [
        {
          ...baseProduct(),
          id: 2,
          name: 'Tomate',
          base_unit_name: 'KG',
          effective_tracks_stock: false,
        },
      ],
    });
    renderPage();
    await screen.findByText('Tomate');

    // Un «0» aquí se lee como «se ha terminado», y es justo lo contrario.
    expect(screen.getByText('sin control')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('filters the list by base unit', async () => {
    stubBackend({
      products: [
        baseProduct(),
        {
          ...baseProduct(),
          id: 2,
          sku: 'P000002',
          name: 'Tomate',
          base_unit_name: 'KG',
          is_sold_by_weight: true,
        },
      ],
    });
    renderPage();
    await screen.findByText('Tomate');

    await userEvent.selectOptions(screen.getByLabelText('Unidad'), 'KG');

    expect(screen.queryByText('Agua 1L')).not.toBeInTheDocument();
    // Coste y PVP, los dos tecleables en la fila para un producto al peso.
    expect(screen.getAllByText('€/KG')).toHaveLength(2);
  });

  it('does not save a price that has not really changed', async () => {
    const backend = stubBackend({
      products: [
        { ...baseProduct(), name: 'Tomate', base_unit_name: 'KG', is_sold_by_weight: true },
      ],
    });
    renderPage();
    await screen.findByText('Tomate');

    const price = screen.getByLabelText('PVP de venta de Tomate');
    await userEvent.clear(price);
    // "0,60" es lo mismo que el "0.600000" guardado: no hay nada que guardar,
    // y una entrada de más en el histórico de precios sería ruido.
    await userEvent.type(price, '0,60{Enter}');

    expect(backend.manualPriceCalls).toEqual([]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
