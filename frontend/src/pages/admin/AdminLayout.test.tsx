import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type Incident } from '@/features/notifications/api';

import { AdminLayout } from './AdminLayout';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

const ME = {
  id: 1,
  email: 'admin@example.com',
  full_name: 'Admin Uno',
  role: 'ADMIN',
  permissions: ['admin.access', 'notification.read', 'product.read'],
};

const OPEN_INCIDENTS: Incident[] = [
  {
    id: 1,
    rule_id: 1,
    rule_name: 'Stock bajo',
    severity: 'HIGH',
    subject_type: 'product',
    subject_id: 10,
    message: 'Quedan dos unidades.',
    status: 'OPEN',
    first_detected_at: '2026-08-17T10:00:00Z',
    last_seen_at: '2026-08-17T10:00:00Z',
    resolved_at: null,
  },
];

function renderLayout() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (url.includes('/settings/values')) {
        return Promise.resolve(jsonResponse({ 'app.display_name': 'Mi tienda' }));
      }
      if (url.includes('/incidents?status=OPEN'))
        return Promise.resolve(jsonResponse(OPEN_INCIDENTS));
      return Promise.reject(new Error(`Unexpected fetch to ${url}`));
    }),
  );

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<p>Inicio de administración</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('AdminLayout', () => {
  it('places alerts between Inicio and Inventario and makes open alerts visible', async () => {
    renderLayout();

    const alerts = await screen.findByRole('link', { name: /Avisos/ });
    const badge = await screen.findByLabelText('1 avisos sin resolver');
    const navigation = alerts.closest('nav')!;
    const destinations = within(navigation)
      .getAllByRole('link')
      .map((link) => new URL(link.getAttribute('href')!, 'http://test').pathname);

    expect(destinations.slice(0, 3)).toEqual([
      '/admin',
      '/admin/notifications',
      '/admin/inventory',
    ]);
    expect(badge).toHaveClass('bg-red-100', 'animate-pulse');
  });
});
