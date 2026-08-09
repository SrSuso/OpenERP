import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';
import { type Product, type ProductCategory } from '@/features/catalog/api';
import { type StockBalance } from '@/features/inventory/api';
import { type ProductPurchaseHistoryEntry } from '@/features/purchasing/api';
import { type Supplier } from '@/features/suppliers/api';
import { type Tax } from '@/features/pricing/api';

import { ProductDetailPage } from './ProductDetailPage';

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
    'supplier.read',
    'supplier.manage',
    'purchase.read',
  ],
};

const TAXES: Tax[] = [{ id: 1, name: 'IVA general', rate: '21', is_active: true }];
const CATEGORIES_WITH_INHERITED_TAX: ProductCategory[] = [
  { id: 1, name: 'Bebidas', is_active: true, margin_rate: '30', taxes: [TAXES[0]!] },
];
const CATEGORIES: ProductCategory[] = [
  { id: 1, name: 'Bebidas', is_active: true, margin_rate: '30', taxes: [] },
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

function stubBackend(options: { categories?: ProductCategory[] } = {}) {
  const categories = options.categories ?? CATEGORIES;
  const product = baseProduct();
  const supplier: Supplier = {
    id: 5,
    name: 'Distribuciones Ejemplo SL',
    tax_id: null,
    email: null,
    phone: null,
    address: '',
    is_active: true,
  };
  const purchaseHistory: ProductPurchaseHistoryEntry[] = [
    {
      purchase_order_id: 7,
      date: new Date().toISOString(),
      status: 'RECEIVED',
      supplier_id: 5,
      supplier_name: supplier.name,
      package_name: 'UNIT',
      quantity_packages: '24',
      unit_cost: '0.250000',
    },
  ];
  const stockBalances: StockBalance[] = [
    {
      product_id: 1,
      product_sku: 'P000001',
      warehouse_id: 1,
      location_id: 1,
      lot_id: null,
      quantity: '42',
    },
  ];
  const updateCalls: Record<string, unknown>[] = [];
  const pricingCalls: Record<string, unknown>[] = [];
  const addPackageCalls: Record<string, unknown>[] = [];
  const deactivateCalls: number[] = [];
  const activateCalls: number[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = () =>
        init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (method === 'GET' && /\/products\/1$/.test(url))
        return Promise.resolve(jsonResponse(product));
      if (method === 'GET' && url.includes('/product-categories')) {
        return Promise.resolve(jsonResponse(categories));
      }
      if (method === 'GET' && url.includes('/pos-categories'))
        return Promise.resolve(jsonResponse([]));
      if (method === 'GET' && url.includes('/taxes')) return Promise.resolve(jsonResponse(TAXES));
      if (method === 'GET' && /\/suppliers\?/.test(url))
        return Promise.resolve(jsonResponse([supplier]));
      if (method === 'GET' && /\/products\/1\/purchase-history$/.test(url)) {
        return Promise.resolve(jsonResponse(purchaseHistory));
      }
      if (method === 'GET' && /\/stock-balance\?/.test(url)) {
        return Promise.resolve(jsonResponse(stockBalances));
      }
      if (method === 'PATCH' && /\/products\/1\/pricing$/.test(url)) {
        const b = body();
        pricingCalls.push(b);
        if ('margin_rate' in b) product.margin_rate = b['margin_rate'] as string | null;
        if ('tax_ids' in b) {
          const ids = b['tax_ids'] as number[];
          product.taxes = TAXES.filter((t) => ids.includes(t.id));
        }
        product.list_price = '9.990000';
        return Promise.resolve(jsonResponse(product));
      }
      if (method === 'PATCH' && /\/products\/1$/.test(url)) {
        const b = body();
        updateCalls.push(b);
        Object.assign(product, b);
        return Promise.resolve(jsonResponse(product));
      }
      if (method === 'POST' && /\/products\/1\/packages$/.test(url)) {
        const b = body();
        addPackageCalls.push(b);
        product.packages.push({
          id: 2,
          name: b['name'] as string,
          factor: b['factor'] as string,
          is_base: false,
          barcodes: [],
        });
        return Promise.resolve(jsonResponse(product));
      }
      if (method === 'POST' && /\/products\/1\/deactivate$/.test(url)) {
        deactivateCalls.push(1);
        product.is_active = false;
        return Promise.resolve(jsonResponse(product));
      }
      if (method === 'POST' && /\/products\/1\/activate$/.test(url)) {
        activateCalls.push(1);
        product.is_active = true;
        return Promise.resolve(jsonResponse(product));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { updateCalls, pricingCalls, addPackageCalls, deactivateCalls, activateCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/catalog/products/1']}>
          <Routes>
            <Route path="/admin/catalog/products/:productId" element={<ProductDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('ProductDetailPage', () => {
  it('edits general fields, price/taxes and formatos, and shows current stock', async () => {
    const backend = stubBackend();
    renderPage();

    // Stock, siempre visible en la cabecera
    await screen.findByText(/Stock: 42 uds\./);

    // General
    await screen.findByDisplayValue('Agua 1L');
    const nameInput = screen.getByDisplayValue('Agua 1L');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Agua mineral 1L');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findAllByText(/Agua mineral 1L/)).not.toHaveLength(0);
    expect(backend.updateCalls[0]).toMatchObject({ name: 'Agua mineral 1L' });

    // Precios
    await userEvent.click(screen.getByRole('button', { name: 'Precios' }));
    const marginInput = screen.getByPlaceholderText('heredado: 30%');
    await userEvent.type(marginInput, '15');
    await userEvent.click(screen.getByRole('button', { name: /IVA general/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar precio' }));
    expect(await screen.findByText('9,99 €')).toBeInTheDocument();
    expect(backend.pricingCalls).toEqual([{ cost: '0.300000', margin_rate: '15', tax_ids: [1] }]);

    // Formatos
    await userEvent.click(screen.getByRole('button', { name: 'Formatos' }));
    await userEvent.type(screen.getByLabelText('Nuevo formato'), 'PACK 6');
    await userEvent.type(screen.getByLabelText('Factor'), '6');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir formato' }));
    await screen.findByText('PACK 6');
    expect(backend.addPackageCalls).toEqual([{ name: 'PACK 6', factor: '6', barcode: null }]);

    // Compras — resumen por proveedor + historial completo, ambos
    // mencionan el mismo proveedor, así que se comprueba con findAllByText.
    await userEvent.click(screen.getByRole('button', { name: 'Compras' }));
    expect(await screen.findAllByText('Distribuciones Ejemplo SL')).toHaveLength(2);
    expect(screen.getByText('#7')).toBeInTheDocument();
  });

  it('shows the category-inherited taxes pre-checked, without turning them into an override', async () => {
    const backend = stubBackend({ categories: CATEGORIES_WITH_INHERITED_TAX });
    renderPage();

    await screen.findByDisplayValue('Agua 1L');
    await userEvent.click(screen.getByRole('button', { name: 'Precios' }));

    // Marcado visualmente aunque el producto no tiene impuestos propios —
    // así no parece que "no se aplica ningún impuesto".
    expect(screen.getByRole('button', { name: /IVA general/, pressed: true })).toBeInTheDocument();
    expect(screen.getByText(/heredados de "Bebidas"/)).toBeInTheDocument();

    // Guardar sin tocar los chips sigue mandando tax_ids vacío (sigue
    // heredando) — nunca el conjunto de la categoría como si fuera propio.
    await userEvent.click(screen.getByRole('button', { name: 'Guardar precio' }));
    expect(backend.pricingCalls).toEqual([{ cost: '0.300000', margin_rate: null, tax_ids: [] }]);
  });

  it('confirms before deactivating, and offers to reactivate afterwards', async () => {
    const backend = stubBackend();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    await screen.findByDisplayValue('Agua 1L');
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));

    expect(confirmSpy).toHaveBeenCalledWith('¿Desactivar «Agua 1L»? Dejará de venderse en el TPV.');
    expect(backend.deactivateCalls).toEqual([1]);
    await screen.findByText(/Inactivo/);

    await userEvent.click(screen.getByRole('button', { name: 'Reactivar' }));
    expect(backend.activateCalls).toEqual([1]);
    await screen.findByText(/Activo/);
  });

  it('does nothing when deactivation is cancelled', async () => {
    const backend = stubBackend();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();

    await screen.findByDisplayValue('Agua 1L');
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));

    expect(backend.deactivateCalls).toEqual([]);
    expect(screen.getByText(/Activo/)).toBeInTheDocument();
  });
});
