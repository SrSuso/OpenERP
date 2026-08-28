import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type Product } from '@/features/catalog/api';

import { ProductsPage } from './ProductsPage';

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

const PRODUCTS: Product[] = [
  {
    id: 1,
    sku: 'P000001',
    name: 'Leche entera',
    description: '',
    category_id: 1,
    category_name: 'Refrigerados',
    pos_category_id: 2,
    pos_category_name: 'Bebidas',
    pos_display_order: 0,
    is_open_price: false,
    is_sold_by_weight: false,
    base_unit_name: 'UDS.',
    cost: '0.70',
    list_price: '1.20',
    tax_rate: '4',
    surcharge_rate: '0',
    effective_tax_rate: '4',
    margin_rate: null,
    margin_amount: null,
    taxes: [],
    price_formula: null,
    min_stock: '10',
    stock_alert_mode: 'CUSTOM',
    track_lots: true,
    track_expiration: true,
    tracks_stock: null,
    effective_tracks_stock: true,
    is_active: true,
    packages: [],
  },
  {
    id: 2,
    sku: 'P000002',
    name: 'Galletas',
    description: '',
    category_id: null,
    category_name: null,
    pos_category_id: null,
    pos_category_name: null,
    pos_display_order: 0,
    is_open_price: false,
    is_sold_by_weight: false,
    base_unit_name: 'KG',
    cost: '2',
    list_price: '3.50',
    tax_rate: '10',
    surcharge_rate: '0',
    effective_tax_rate: '10',
    margin_rate: null,
    margin_amount: null,
    taxes: [],
    price_formula: null,
    min_stock: '0',
    stock_alert_mode: 'GENERAL',
    track_lots: false,
    track_expiration: false,
    tracks_stock: null,
    effective_tracks_stock: true,
    is_active: false,
    packages: [],
  },
];

function stubBackend() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/auth/me')) {
        return Promise.resolve(
          response({
            id: 1,
            email: 'admin@example.com',
            full_name: 'Admin',
            role: 'ADMIN',
            permissions: [
              'admin.access',
              'product.read',
              'product.manage',
              'inventory.read',
              'notification.read',
            ],
          }),
        );
      }
      if (url.includes('/product-categories'))
        return Promise.resolve(
          response([
            {
              id: 1,
              name: 'Refrigerados',
              is_active: true,
              margin_rate: null,
              margin_amount: null,
              price_formula: null,
              tracks_stock: true,
              is_sold_by_weight: false,
              default_unit_name: null,
              taxes: [],
            },
          ]),
        );
      if (url.includes('/pos-categories'))
        return Promise.resolve(
          response([
            { id: 2, name: 'Bebidas', color: '#123456', display_order: 0, is_active: true },
          ]),
        );
      if (url.includes('/units'))
        return Promise.resolve(
          response([
            { id: 1, name: 'UDS.', display_order: 0 },
            { id: 2, name: 'KG', display_order: 1 },
          ]),
        );
      if (url.includes('/stock-balance/totals'))
        return Promise.resolve(
          response([
            { product_id: 1, quantity: '8' },
            { product_id: 2, quantity: '20' },
          ]),
        );
      if (url.endsWith('/alerts'))
        return Promise.resolve(
          response([
            {
              id: 10,
              kind: 'LOW_STOCK',
              title: 'Leche entera',
              product_id: 1,
              stock_current: '8',
              min_stock: '10',
              replenish: '2',
              lot_id: null,
              lot_number: null,
              expiration_date: null,
              days_remaining: null,
              quantity_remaining: null,
            },
          ]),
        );
      if (url.includes('/products?')) {
        const query =
          new URL(url, 'http://test').searchParams.get('search')?.toLocaleLowerCase('es') ?? '';
        return Promise.resolve(
          response(
            PRODUCTS.filter((product) => product.name.toLocaleLowerCase('es').includes(query)),
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    }),
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/inventory/products']}>
          <ProductsPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('ProductsPage V2', () => {
  it('uses a dedicated creation route and contains no inline creation or pricing controls', async () => {
    stubBackend();
    renderPage();
    expect(await screen.findByText('Leche entera')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ Nuevo producto' })).toHaveAttribute(
      'href',
      '/admin/inventory/products/new',
    );
    expect(screen.queryByRole('heading', { name: 'Nuevo producto' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/coste de/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/pvp de venta de/i)).not.toBeInTheDocument();
    expect(screen.queryByText('P000001')).not.toBeInTheDocument();
  });

  it('shows useful stock state and opens the product detail from its name', async () => {
    stubBackend();
    renderPage();
    const row = (await screen.findByText('Leche entera')).closest('tr')!;
    expect(await within(row).findByText('8 UDS.')).toBeInTheDocument();
    expect(await within(row).findByText('Stock bajo')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Leche entera' })).toHaveAttribute(
      'href',
      '/admin/inventory/products/1',
    );
  });

  it('filters by unit, makes active filters visible and clears them', async () => {
    stubBackend();
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('Leche entera');
    await user.click(screen.getByRole('button', { name: 'Filtros' }));
    await user.selectOptions(screen.getByLabelText('Unidad'), 'KG');
    expect(screen.queryByText('Leche entera')).not.toBeInTheDocument();
    expect(screen.getByText('Galletas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar filtro Unidad: KG' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(await screen.findByText('Leche entera')).toBeInTheDocument();
  });

  it('searches products by their visible name', async () => {
    stubBackend();
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('Leche entera');
    await user.type(screen.getByLabelText('Buscar productos'), 'Galletas');
    expect(await screen.findByText('Galletas')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Leche entera')).not.toBeInTheDocument());
  });

  it('uses a responsive filter grid instead of a single crowded row', async () => {
    stubBackend();
    renderPage();
    await screen.findByText('Leche entera');
    await userEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    expect(screen.getByLabelText('Categoría').parentElement?.parentElement).toHaveClass(
      'sm:grid-cols-2',
      'lg:grid-cols-4',
    );
  });
});
