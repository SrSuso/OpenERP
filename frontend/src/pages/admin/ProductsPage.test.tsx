import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type Product } from '@/features/catalog/api';

import { ProductsPage } from './ProductsPage';

function response(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
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

function stubBackend({
  quickPrice = false,
  canManagePricing = false,
  failPrice = false,
  deferPrice = false,
}: {
  quickPrice?: boolean;
  canManagePricing?: boolean;
  failPrice?: boolean;
  deferPrice?: boolean;
} = {}) {
  const products = PRODUCTS.map((product) => ({ ...product }));
  const priceCalls: { id: number; list_price: string }[] = [];
  let resolvePrice: (() => void) | null = null;

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
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
              ...(canManagePricing ? ['pricing.manage'] : []),
            ],
          }),
        );
      }
      if (url.includes('/product-categories')) {
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
              quick_price_edit: quickPrice,
              default_unit_name: null,
              taxes: [],
            },
          ]),
        );
      }
      if (url.includes('/pos-categories')) {
        return Promise.resolve(
          response([
            { id: 2, name: 'Bebidas', color: '#123456', display_order: 0, is_active: true },
          ]),
        );
      }
      if (url.includes('/units')) {
        return Promise.resolve(
          response([
            { id: 1, name: 'UDS.', display_order: 0 },
            { id: 2, name: 'KG', display_order: 1 },
          ]),
        );
      }
      if (url.includes('/stock-balance/totals')) {
        return Promise.resolve(
          response([
            { product_id: 1, quantity: '8' },
            { product_id: 2, quantity: '20' },
          ]),
        );
      }
      if (url.endsWith('/alerts')) {
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
      }
      const manualMatch = /\/products\/(\d+)\/pricing\/manual-price$/.exec(url);
      if (method === 'PUT' && manualMatch) {
        const body = JSON.parse(init?.body as string) as { list_price: string };
        const id = Number(manualMatch[1]);
        priceCalls.push({ id, list_price: body.list_price });
        if (failPrice) {
          return Promise.resolve(
            response(
              { error: { code: 'internal_error', message: 'No se pudo guardar.' } },
              { status: 500 },
            ),
          );
        }
        const complete = () => {
          const product = products.find((item) => item.id === id)!;
          product.list_price = body.list_price;
          return response(product);
        };
        if (deferPrice) {
          return new Promise<Response>((resolve) => {
            resolvePrice = () => resolve(complete());
          });
        }
        return Promise.resolve(complete());
      }
      if (url.includes('/products?')) {
        const query =
          new URL(url, 'http://test').searchParams.get('search')?.toLocaleLowerCase('es') ?? '';
        return Promise.resolve(
          response(
            products.filter((product) => product.name.toLocaleLowerCase('es').includes(query)),
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${method} ${url}`));
    }),
  );

  return {
    priceCalls,
    resolvePrice: () => {
      if (!resolvePrice) throw new Error('No deferred price request.');
      resolvePrice();
    },
  };
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
  it('uses the dedicated creation route, hides internal SKUs and never edits cost inline', async () => {
    stubBackend();
    renderPage();
    expect(await screen.findByText('Leche entera')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ Nuevo producto' })).toHaveAttribute(
      'href',
      '/admin/inventory/products/new',
    );
    expect(screen.queryByLabelText(/coste de/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/pvp de venta de/i)).not.toBeInTheDocument();
    expect(screen.queryByText('P000001')).not.toBeInTheDocument();
  });

  it('shows filters by default and hiding them preserves active values and chips', async () => {
    stubBackend();
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('Leche entera');
    expect(screen.getByRole('button', { name: 'Ocultar filtros' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Unidad'), 'KG');
    expect(screen.queryByText('Leche entera')).not.toBeInTheDocument();
    expect(screen.getByText('Galletas')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Ocultar filtros/ }));
    expect(screen.queryByLabelText('Unidad')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar filtro Unidad: KG' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Mostrar filtros/ }));
    expect(screen.getByLabelText('Unidad')).toHaveValue('KG');
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(await screen.findByText('Leche entera')).toBeInTheDocument();
  });

  it('only makes PVP editable when category and pricing permission both allow it', async () => {
    stubBackend({ quickPrice: false, canManagePricing: true });
    const first = renderPage();
    await screen.findByText('Leche entera');
    expect(screen.queryByLabelText('PVP de venta de Leche entera')).not.toBeInTheDocument();
    first.unmount();

    stubBackend({ quickPrice: true, canManagePricing: false });
    const second = renderPage();
    await screen.findByText('Leche entera');
    expect(screen.queryByLabelText('PVP de venta de Leche entera')).not.toBeInTheDocument();
    second.unmount();

    stubBackend({ quickPrice: true, canManagePricing: true });
    renderPage();
    expect(await screen.findByLabelText('PVP de venta de Leche entera')).toHaveValue('1,2');
  });

  it('accepts a decimal comma, confirms the change and reports saving and saved states', async () => {
    const backend = stubBackend({ quickPrice: true, canManagePricing: true, deferPrice: true });
    renderPage();
    const user = userEvent.setup();
    const input = await screen.findByLabelText('PVP de venta de Leche entera');
    await user.clear(input);
    await user.type(input, '1,85{Enter}');

    const dialog = screen.getByRole('dialog', { name: 'Cambiar el PVP de Leche entera' });
    expect(
      within(dialog).getByText(
        (_, element) => element?.textContent?.startsWith('1,85 €/UDS.') ?? false,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Tienes 8 UDS/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cambiar' }));
    expect(await screen.findByText('Guardando…')).toBeInTheDocument();
    expect(backend.priceCalls).toEqual([{ id: 1, list_price: '1.85' }]);

    act(() => backend.resolvePrice());
    expect(await screen.findByText('Guardado')).toBeInTheDocument();
    expect(await screen.findByLabelText('PVP de venta de Leche entera')).toHaveValue('1,85');
  });

  it('proposes on blur, cancels confirmation without writing and Escape restores the value', async () => {
    const backend = stubBackend({ quickPrice: true, canManagePricing: true });
    renderPage();
    const user = userEvent.setup();
    const input = await screen.findByLabelText('PVP de venta de Leche entera');
    await user.clear(input);
    await user.type(input, '1,40');
    await user.click(screen.getByRole('heading', { name: 'Productos' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(backend.priceCalls).toEqual([]);
    expect(await screen.findByLabelText('PVP de venta de Leche entera')).toHaveValue('1,2');

    const restored = screen.getByLabelText('PVP de venta de Leche entera');
    await user.clear(restored);
    await user.type(restored, '9{Escape}');
    expect(restored).toHaveValue('1,2');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not propose invalid or numerically unchanged values', async () => {
    const backend = stubBackend({ quickPrice: true, canManagePricing: true });
    renderPage();
    const user = userEvent.setup();
    const input = await screen.findByLabelText('PVP de venta de Leche entera');
    await user.clear(input);
    await user.type(input, '-1{Enter}');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '1,200{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(backend.priceCalls).toEqual([]);
  });

  it('keeps the previous PVP and shows useful feedback when backend rejects it', async () => {
    const backend = stubBackend({ quickPrice: true, canManagePricing: true, failPrice: true });
    renderPage();
    const user = userEvent.setup();
    const input = await screen.findByLabelText('PVP de venta de Leche entera');
    await user.clear(input);
    await user.type(input, '2{Enter}');
    await user.click(screen.getByRole('button', { name: 'Cambiar' }));
    expect(
      await screen.findByText('No se ha podido guardar el PVP. El precio anterior no ha cambiado.'),
    ).toBeInTheDocument();
    expect(backend.priceCalls).toEqual([{ id: 1, list_price: '2' }]);
    expect(screen.getByLabelText('PVP de venta de Leche entera')).toHaveValue('1,2');
  });

  it('shows useful stock state and searches by visible product name', async () => {
    stubBackend();
    renderPage();
    const user = userEvent.setup();
    const row = (await screen.findByText('Leche entera')).closest('tr')!;
    expect(
      await within(row).findByText((_, element) => element?.textContent === '8 UDS.'),
    ).toBeInTheDocument();
    expect(await within(row).findByText('Stock bajo')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Buscar productos'), 'Galletas');
    expect(await screen.findByText('Galletas')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Leche entera')).not.toBeInTheDocument());
  });
});
