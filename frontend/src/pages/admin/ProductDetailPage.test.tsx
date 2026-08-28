import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type Product } from '@/features/catalog/api';

import { ProductDetailPage } from './ProductDetailPage';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function productFixture(): Product {
  return {
    id: 1,
    sku: 'P000001',
    name: 'Leche entera',
    description: '',
    category_id: 1,
    category_name: 'Refrigerados',
    pos_category_id: null,
    pos_category_name: null,
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
    packages: [{ id: 1, name: 'UDS.', factor: '1', is_base: true, barcodes: [] }],
  };
}

function stubBackend(notificationManage = true) {
  const product = productFixture();
  const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ method, url, body });
      if (url.includes('/auth/me'))
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
              ...(notificationManage ? ['notification.manage'] : []),
            ],
          }),
        );
      if (method === 'GET' && url.endsWith('/products/1'))
        return Promise.resolve(response(product));
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
              default_unit_name: 'UDS.',
              taxes: [],
            },
          ]),
        );
      if (url.includes('/pos-categories')) return Promise.resolve(response([]));
      if (url.includes('/units'))
        return Promise.resolve(response([{ id: 1, name: 'UDS.', display_order: 0 }]));
      if (url.includes('/taxes')) return Promise.resolve(response([]));
      if (url.includes('/suppliers?')) return Promise.resolve(response([]));
      if (url.includes('/stock-balance?'))
        return Promise.resolve(
          response([
            {
              product_id: 1,
              product_sku: 'P000001',
              product_name: 'Leche entera',
              warehouse_id: 1,
              warehouse_name: 'Principal',
              location_id: 1,
              location_name: 'Almacén',
              lot_id: null,
              quantity: '8',
            },
          ]),
        );
      if (method === 'GET' && url.endsWith('/notification-settings'))
        return Promise.resolve(
          response({
            stock_general: { enabled: true, min_stock: '5' },
            general_expiration: { enabled: true, days_before_expiration: 5 },
            product_expirations: [
              { product_id: 1, product_name: 'Leche entera', days_before_expiration: 7 },
            ],
          }),
        );
      if (method === 'GET' && url.endsWith('/alerts'))
        return Promise.resolve(
          response([
            {
              id: 1,
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
      if (url.includes('/lots?')) return Promise.resolve(response([]));
      if (method === 'PATCH' && url.endsWith('/products/1')) {
        Object.assign(product, body);
        if (body?.['stock_alert_mode'] !== 'CUSTOM') product.min_stock = '0';
        if (body?.['tracks_stock'] === false) product.effective_tracks_stock = false;
        return Promise.resolve(response(product));
      }
      if (method === 'DELETE' && url.endsWith('/notification-settings/expiration/products/1'))
        return Promise.resolve(
          response({
            stock_general: { enabled: true, min_stock: '5' },
            general_expiration: { enabled: true, days_before_expiration: 5 },
            product_expirations: [],
          }),
        );
      if (method === 'PUT' && url.endsWith('/notification-settings/expiration/products/1'))
        return Promise.resolve(
          response({
            stock_general: { enabled: true, min_stock: '5' },
            general_expiration: { enabled: true, days_before_expiration: 5 },
            product_expirations: [
              {
                product_id: 1,
                product_name: 'Leche entera',
                days_before_expiration: body?.['days_before_expiration'],
              },
            ],
          }),
        );
      return Promise.reject(new Error(`Unexpected fetch ${method} ${url}`));
    }),
  );
  return calls;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/inventory/products/1']}>
          <Routes>
            <Route path="/admin/inventory/products/:productId" element={<ProductDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('ProductDetailPage V2', () => {
  it('groups stock, lots, expiration and alerts in one product tab', async () => {
    stubBackend();
    renderPage();
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Leche entera' })).toBeInTheDocument();
    expect(await screen.findByText(/Stock: 8 UDS\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Inventario y avisos' }));
    expect(await screen.findByText('Mínimo efectivo')).toBeInTheDocument();
    expect(screen.getByText('10 UDS.')).toBeInTheDocument();
    expect(screen.getByText('Stock bajo')).toBeInTheDocument();
    expect(screen.getByLabelText('Definir mínimo para este producto')).toBeChecked();
    expect(screen.getByLabelText('Personalizar para este producto')).toBeChecked();
    expect(screen.getByRole('heading', { name: 'Lotes del producto' })).toBeInTheDocument();
  });

  it('saves general stock and expiration through their single shared sources', async () => {
    const calls = stubBackend();
    renderPage();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Leche entera' });
    await user.click(screen.getByRole('button', { name: 'Inventario y avisos' }));
    await user.click(await screen.findByLabelText(/Usar mínimo general/));
    await user.click(screen.getByLabelText(/Usar configuración general/));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === 'PATCH' &&
            call.url.endsWith('/products/1') &&
            call.body?.['stock_alert_mode'] === 'GENERAL',
        ),
      ).toBe(true),
    );
    expect(
      calls.some(
        (call) =>
          call.method === 'DELETE' &&
          call.url.endsWith('/notification-settings/expiration/products/1'),
      ),
    ).toBe(true);
    expect(await screen.findByText('Inventario y avisos guardados.')).toBeInTheDocument();
  });

  it('hides active stock threshold controls when stock is not tracked', async () => {
    stubBackend();
    renderPage();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Leche entera' });
    await user.click(screen.getByRole('button', { name: 'Inventario y avisos' }));
    await user.selectOptions(await screen.findByLabelText('Control de existencias'), 'no');
    expect(
      screen.getByText(/no disponible porque este producto no controla existencias/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Definir mínimo para este producto')).not.toBeInTheDocument();
  });

  it('can disable the product stock alert explicitly', async () => {
    const calls = stubBackend();
    renderPage();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Leche entera' });
    await user.click(screen.getByRole('button', { name: 'Inventario y avisos' }));
    await user.click(await screen.findByLabelText('No avisar por stock'));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === 'PATCH' &&
            call.url.endsWith('/products/1') &&
            call.body?.['stock_alert_mode'] === 'DISABLED' &&
            !('min_stock' in (call.body ?? {})),
        ),
      ).toBe(true),
    );
  });

  it('protects inventory alert edits when changing product tabs', async () => {
    stubBackend();
    renderPage();
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await screen.findByRole('heading', { name: 'Leche entera' });
    await user.click(screen.getByRole('button', { name: 'Inventario y avisos' }));
    await user.click(await screen.findByLabelText(/Usar mínimo general/));
    await user.click(screen.getByRole('button', { name: 'General' }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Aviso de stock' })).toBeInTheDocument();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'General' }));
    expect(screen.getByRole('heading', { name: 'Información general' })).toBeInTheDocument();
  });

  it('keeps notification choices read-only without notification.manage', async () => {
    stubBackend(false);
    renderPage();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Leche entera' });
    await user.click(screen.getByRole('button', { name: 'Inventario y avisos' }));
    expect(await screen.findByLabelText('Definir mínimo para este producto')).toBeDisabled();
    expect(
      screen.getByText(/puede ver esta configuración, pero no modificar avisos/i),
    ).toBeInTheDocument();
  });
});
