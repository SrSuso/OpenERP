import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';

import { NewProductPage } from './NewProductPage';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubBackend(notificationManage = true) {
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
              'pricing.manage',
              'notification.read',
              ...(notificationManage ? ['notification.manage'] : []),
            ],
          }),
        );
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
      if (url.endsWith('/notification-settings'))
        return Promise.resolve(
          response({
            stock_general: { enabled: true, min_stock: '5' },
            general_expiration: { enabled: true, days_before_expiration: 5 },
            product_expirations: [],
          }),
        );
      if (method === 'POST' && url.endsWith('/pricing/preview'))
        return Promise.resolve(response({ result: '1.500000' }));
      if (method === 'POST' && url.endsWith('/products')) {
        return Promise.resolve(
          response(
            {
              id: 9,
              sku: 'P000009',
              name: body?.['name'],
              description: '',
              category_id: 1,
              category_name: 'Refrigerados',
              pos_category_id: null,
              pos_category_name: null,
              pos_display_order: 0,
              is_open_price: false,
              is_sold_by_weight: false,
              base_unit_name: 'UDS.',
              cost: '1',
              list_price: '1.5',
              tax_rate: '0',
              surcharge_rate: '0',
              effective_tax_rate: '0',
              margin_rate: null,
              margin_amount: null,
              taxes: [],
              price_formula: null,
              min_stock: body?.['min_stock'],
              stock_alert_mode: body?.['stock_alert_mode'],
              track_lots: true,
              track_expiration: true,
              tracks_stock: null,
              effective_tracks_stock: true,
              is_active: true,
              packages: [],
            },
            201,
          ),
        );
      }
      if (method === 'PUT' && url.endsWith('/notification-settings/expiration/products/9'))
        return Promise.resolve(
          response({
            stock_general: { enabled: true, min_stock: '5' },
            general_expiration: { enabled: true, days_before_expiration: 5 },
            product_expirations: [
              { product_id: 9, product_name: 'Leche entera', days_before_expiration: 7 },
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
        <MemoryRouter initialEntries={['/admin/inventory/products/new']}>
          <Routes>
            <Route path="/admin/inventory/products/new" element={<NewProductPage />} />
            <Route path="/admin/inventory/products/:id" element={<p>Ficha creada</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('NewProductPage', () => {
  it('creates stock and expiration choices from the dedicated form', async () => {
    const calls = stubBackend();
    renderPage();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Nuevo producto' });
    await user.type(screen.getByLabelText('Nombre'), 'Leche entera');
    await user.selectOptions(screen.getByLabelText('Categoría'), '1');
    await user.click(screen.getByLabelText('Definir mínimo para este producto'));
    const minimumStock = screen.getByLabelText('Stock mínimo');
    await user.clear(minimumStock);
    await user.type(minimumStock, '12');
    await user.click(screen.getByLabelText('Control de lotes'));
    await user.click(screen.getByLabelText('Control de caducidad'));
    await user.click(screen.getByLabelText('Personalizar para este producto'));
    const expirationDays = screen.getByLabelText('Avisar con');
    await user.clear(expirationDays);
    await user.type(expirationDays, '7');
    const cost = screen.getByLabelText('Coste');
    await user.clear(cost);
    await user.type(cost, '1');
    const price = screen.getByLabelText('Precio de venta');
    await user.clear(price);
    await user.type(price, '1.5');
    await user.click(screen.getByRole('button', { name: 'Crear producto' }));

    expect(await screen.findByText('Ficha creada')).toBeInTheDocument();
    const createCall = calls.find(
      (call) => call.method === 'POST' && call.url.endsWith('/products'),
    );
    expect(createCall?.body).toMatchObject({
      name: 'Leche entera',
      stock_alert_mode: 'CUSTOM',
      min_stock: '12',
      track_lots: true,
      track_expiration: true,
    });
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === 'PUT' &&
            call.url.endsWith('/notification-settings/expiration/products/9') &&
            call.body?.['days_before_expiration'] === 7,
        ),
      ).toBe(true),
    );
  });

  it('shows unavailable stock alerts when stock control is disabled', async () => {
    stubBackend();
    renderPage();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Nuevo producto' });
    await user.selectOptions(screen.getByLabelText('Control de existencias'), 'no');
    expect(
      screen.getByText(/no disponible porque este producto no controla existencias/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Definir mínimo para este producto')).not.toBeInTheDocument();
  });

  it('keeps product alert choices read-only without notification management permission', async () => {
    stubBackend(false);
    renderPage();
    expect(await screen.findByLabelText('Definir mínimo para este producto')).toBeDisabled();
    expect(screen.getByText(/usará el mínimo general/i)).toBeInTheDocument();
  });
});
