import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type NotificationSettings } from '@/features/notifications/api';

import { NotificationsPage } from './NotificationsPage';

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

function stubBackend(empty = false) {
  let settings: NotificationSettings = {
    stock_general: { enabled: true, min_stock: '5' },
    general_expiration: { enabled: true, days_before_expiration: 5 },
    product_expirations: [{ product_id: 2, product_name: 'Yogur', days_before_expiration: 2 }],
  };
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
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
              'notification.read',
              'notification.manage',
              'product.read',
              'lot.read',
            ],
          }),
        );
      if (method === 'GET' && url.endsWith('/alerts'))
        return Promise.resolve(
          response(
            empty
              ? []
              : [
                  {
                    id: 1,
                    kind: 'LOW_STOCK',
                    title: 'Leche',
                    product_id: 1,
                    stock_current: '3',
                    min_stock: '5',
                    replenish: '2',
                    lot_id: null,
                    lot_number: null,
                    expiration_date: null,
                    days_remaining: null,
                    quantity_remaining: null,
                  },
                  {
                    id: 2,
                    kind: 'EXPIRATION',
                    title: 'Yogur',
                    product_id: 2,
                    stock_current: null,
                    min_stock: null,
                    replenish: null,
                    lot_id: 3,
                    lot_number: 'L-2',
                    expiration_date: '2026-08-30',
                    days_remaining: 2,
                    quantity_remaining: '4',
                  },
                ],
          ),
        );
      if (method === 'GET' && url.endsWith('/notification-settings'))
        return Promise.resolve(response(settings));
      if (method === 'PUT' && url.endsWith('/notification-settings/stock')) {
        settings = { ...settings, stock_general: body as NotificationSettings['stock_general'] };
        return Promise.resolve(response(settings));
      }
      if (method === 'PUT' && url.endsWith('/notification-settings/expiration/general')) {
        settings = {
          ...settings,
          general_expiration: body as NotificationSettings['general_expiration'],
        };
        return Promise.resolve(response(settings));
      }
      if (method === 'DELETE' && url.endsWith('/notification-settings/expiration/products/2')) {
        settings = { ...settings, product_expirations: [] };
        return Promise.resolve(response(settings));
      }
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
        <MemoryRouter>
          <NotificationsPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('NotificationsPage V2', () => {
  it('shows only stock and expiration business alerts', async () => {
    const calls = stubBackend();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Stock bajo' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Caducidad' })).toBeInTheDocument();
    expect(screen.queryByText(/otros avisos/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reglas/i)).not.toBeInTheDocument();
    expect(calls.some((call) => call.url.includes('notification-rules'))).toBe(false);
    expect(calls.some((call) => call.url.includes('incidents'))).toBe(false);
  });

  it('shows a simple empty state', async () => {
    stubBackend(true);
    renderPage();
    expect(await screen.findByText('No hay avisos activos')).toBeInTheDocument();
    expect(screen.getByText(/stock bajo ni lotes próximos/i)).toBeInTheDocument();
  });

  it('updates the general stock value and explains its product priority', async () => {
    const calls = stubBackend();
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Configuración de avisos' }));
    expect(screen.getByText(/cada producto puede sustituirlo o desactivar/i)).toBeInTheDocument();
    const minimum = screen.getByLabelText('Mínimo general');
    await user.clear(minimum);
    await user.type(minimum, '8');
    await user.click(screen.getByRole('button', { name: 'Guardar stock general' }));
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === 'PUT' &&
            call.url.endsWith('/notification-settings/stock') &&
            JSON.stringify(call.body) === JSON.stringify({ enabled: true, min_stock: '8' }),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText('Configuración general de stock guardada.')).toBeInTheDocument();
  });

  it('shows expiration exceptions and can return a product to the general value', async () => {
    const calls = stubBackend();
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Configuración de avisos' }));
    expect(screen.getByText('Yogur')).toBeInTheDocument();
    expect(screen.getByText('2 días antes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quitar' }));
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === 'DELETE' &&
            call.url.endsWith('/notification-settings/expiration/products/2'),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText('No hay configuraciones específicas')).toBeInTheDocument();
  });
});
