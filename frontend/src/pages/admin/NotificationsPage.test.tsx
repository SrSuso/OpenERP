import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type Product } from '@/features/catalog/api';
import { type ActiveAlert, type NotificationSettings } from '@/features/notifications/api';

import { NotificationsPage } from './NotificationsPage';

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
    'notification.read',
    'notification.manage',
    'product.read',
    'lot.read',
  ],
};

const YOGURT: Product = {
  id: 42,
  sku: 'P000042',
  name: 'Yogur natural',
  description: '',
  category_id: null,
  category_name: null,
  pos_category_id: null,
  pos_category_name: null,
  pos_display_order: 0,
  is_open_price: false,
  is_sold_by_weight: false,
  base_unit_name: 'UDS.',
  cost: '0.400000',
  list_price: '0.750000',
  tax_rate: '4.000000',
  surcharge_rate: '0.000000',
  effective_tax_rate: '4.000000',
  margin_rate: null,
  margin_amount: null,
  taxes: [],
  price_formula: null,
  min_stock: '5.000000',
  track_lots: true,
  track_expiration: true,
  tracks_stock: true,
  effective_tracks_stock: true,
  is_active: true,
  packages: [],
};

const ACTIVE_ALERTS: ActiveAlert[] = [
  {
    id: 1,
    kind: 'LOW_STOCK',
    title: 'Leche entera',
    message: null,
    severity: 'MEDIUM_HIGH',
    product_id: 10,
    stock_current: '7.000000',
    min_stock: '10.000000',
    replenish: '3.000000',
    lot_id: null,
    lot_number: null,
    expiration_date: null,
    days_remaining: null,
    quantity_remaining: null,
  },
  {
    id: 2,
    kind: 'EXPIRATION',
    title: 'Yogur natural',
    message: null,
    severity: 'MEDIUM_HIGH',
    product_id: 42,
    stock_current: null,
    min_stock: null,
    replenish: null,
    lot_id: 52,
    lot_number: 'L24051',
    expiration_date: '2026-09-12',
    days_remaining: 2,
    quantity_remaining: '8.000000',
  },
  {
    id: 3,
    kind: 'OTHER',
    title: 'Revisar escaparate',
    message: 'La regla personalizada sigue activa.',
    severity: 'LOW',
    product_id: null,
    stock_current: null,
    min_stock: null,
    replenish: null,
    lot_id: null,
    lot_number: null,
    expiration_date: null,
    days_remaining: null,
    quantity_remaining: null,
  },
];

interface StubOptions {
  empty?: boolean;
  permissions?: string[];
}

function stubBackend(options: StubOptions = {}) {
  let settings: NotificationSettings = {
    general_expiration: { enabled: true, days_before_expiration: 5 },
    product_expirations: [],
    custom_rules: [{ name: 'Revisar escaparate', is_active: true }],
  };
  const calls: { method: string; url: string; body: unknown }[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body: unknown =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ method, url, body });

      if (url.includes('/auth/me')) {
        return Promise.resolve(
          jsonResponse({ ...ME, permissions: options.permissions ?? ME.permissions }),
        );
      }
      if (method === 'GET' && /\/alerts$/.test(url)) {
        return Promise.resolve(jsonResponse(options.empty ? [] : ACTIVE_ALERTS));
      }
      if (method === 'GET' && /\/notification-settings$/.test(url)) {
        return Promise.resolve(jsonResponse(settings));
      }
      if (method === 'GET' && /\/products\?/.test(url)) {
        return Promise.resolve(jsonResponse([YOGURT]));
      }
      if (method === 'PUT' && /\/notification-settings\/expiration\/general$/.test(url)) {
        const update = body as NotificationSettings['general_expiration'];
        settings = { ...settings, general_expiration: update };
        return Promise.resolve(jsonResponse(settings));
      }
      const productMatch = /\/notification-settings\/expiration\/products\/(\d+)$/.exec(url);
      if (method === 'PUT' && productMatch) {
        const update = body as { days_before_expiration: number };
        settings = {
          ...settings,
          product_expirations: [
            {
              product_id: Number(productMatch[1]),
              product_name: YOGURT.name,
              days_before_expiration: update.days_before_expiration,
            },
          ],
        };
        return Promise.resolve(jsonResponse(settings));
      }
      if (method === 'DELETE' && productMatch) {
        settings = { ...settings, product_expirations: [] };
        return Promise.resolve(jsonResponse(settings));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return calls;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter>
          <NotificationsPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('NotificationsPage', () => {
  it('shows active store alerts grouped with useful data and no technical workflow', async () => {
    const calls = stubBackend();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Avisos', level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Stock bajo' })).toBeInTheDocument();
    expect(screen.getByText('Leche entera')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Caducidad' })).toBeInTheDocument();
    expect(screen.getByText('L24051')).toBeInTheDocument();
    expect(screen.getByText('2 días')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Otros avisos' })).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /evaluar ahora/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resolver/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/criticidad/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/condition/i)).not.toBeInTheDocument();
    expect(calls.some((call) => call.url.includes('/notification-fields'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/notification-rules'))).toBe(false);
  });

  it('explains the empty state without incident terminology', async () => {
    stubBackend({ empty: true });
    renderPage();

    expect(await screen.findByText('No hay avisos activos')).toBeInTheDocument();
    expect(screen.queryByText(/incidencia/i)).not.toBeInTheDocument();
  });

  it('configures general expiry and a product override without exposing IDs', async () => {
    const calls = stubBackend();
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Configuración de avisos' }));
    expect(screen.getByRole('heading', { name: 'Stock mínimo' })).toBeInTheDocument();
    expect(screen.getByText('Automático')).toBeInTheDocument();
    expect(screen.getByText(/sustituye por completo a la general/i)).toBeInTheDocument();

    await user.click(
      screen.getByRole('checkbox', {
        name: /avisar para productos sin configuración específica/i,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Guardar configuración general' }));
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === 'PUT' &&
            call.url.endsWith('/notification-settings/expiration/general') &&
            JSON.stringify(call.body) ===
              JSON.stringify({ enabled: false, days_before_expiration: 5 }),
        ),
      ).toBe(true),
    );

    await user.click(screen.getByRole('button', { name: 'Añadir producto' }));
    await user.type(screen.getByLabelText('Producto'), 'Yog');
    await user.click(await screen.findByRole('option', { name: 'Yogur natural' }));
    const daysInputs = screen.getAllByLabelText('Avisar con');
    await user.type(daysInputs[1]!, '2');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Yogur natural')).toBeInTheDocument();
    expect(screen.getByText('2 días antes')).toBeInTheDocument();
    expect(screen.queryByText('P000042')).not.toBeInTheDocument();
    expect(screen.queryByText('42')).not.toBeInTheDocument();
    expect(
      calls.some(
        (call) =>
          call.method === 'PUT' &&
          call.url.endsWith('/notification-settings/expiration/products/42') &&
          JSON.stringify(call.body) === JSON.stringify({ days_before_expiration: 2 }),
      ),
    ).toBe(true);
  });

  it('keeps configuration read-only without management permission', async () => {
    stubBackend({ permissions: ['notification.read', 'product.read', 'lot.read'] });
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Configuración de avisos' }));

    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByLabelText('Avisar con')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Añadir producto' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Guardar configuración general' }),
    ).not.toBeInTheDocument();
  });
});
