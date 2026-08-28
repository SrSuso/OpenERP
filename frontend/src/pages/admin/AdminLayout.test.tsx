import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  permissions: [
    'admin.access',
    'notification.read',
    'product.read',
    'supplier.read',
    'purchase.read',
    'sale.read',
    'return.read',
    'report.read',
    'settings.read',
    'users.manage',
    'roles.manage',
    'pricing.manage',
    'pos_terminal.manage',
    'ticket.manage',
    'job.read',
    'audit.read',
  ],
};

const MANAGER = {
  ...ME,
  email: 'manager@example.com',
  full_name: 'Encargada Uno',
  role: 'MANAGER',
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

function renderLayout(user = ME) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(user));
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
  it('groups the manager operation menu and keeps open alerts visible', async () => {
    renderLayout();

    const alerts = await screen.findByRole('link', { name: /Avisos/ });
    const badge = await screen.findByLabelText('1 avisos sin resolver');
    const navigation = alerts.closest('nav')!;
    expect(navigation).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto', 'overscroll-contain');
    const destinations = within(navigation)
      .getAllByRole('link')
      .map((link) => new URL(link.getAttribute('href')!, 'http://test').pathname);

    expect(screen.getByText('Operación')).toBeInTheDocument();
    expect(destinations).toEqual([
      '/admin',
      '/admin/notifications',
      '/admin/inventory',
      '/admin/purchasing',
      '/admin/sales',
      '/admin/reports',
      '/admin/settings',
    ]);
    expect(badge).toHaveClass('bg-red-100');
    expect(badge).not.toHaveClass('animate-pulse');
  });

  it('does not show administration to a manager, even if an existing permission allows a direct route', async () => {
    renderLayout(MANAGER);

    await screen.findByRole('link', { name: /Encargada Uno/ });
    expect(screen.queryByText('Administración')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Configuración' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inventario' })).toHaveAttribute(
      'href',
      '/admin/inventory',
    );
    expect(screen.getByRole('link', { name: 'Compras' })).toHaveAttribute(
      'href',
      '/admin/purchasing',
    );
    expect(screen.getByRole('link', { name: 'Ventas' })).toHaveAttribute('href', '/admin/sales');
  });

  it('shows the administration group to an admin and keeps grouped pages reachable', async () => {
    renderLayout();

    expect(await screen.findByText('Administración')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Mostrar opciones de Configuración' }),
    );

    expect(screen.getByRole('link', { name: 'Usuarios y roles' })).toHaveAttribute(
      'href',
      '/admin/access',
    );
    expect(screen.getByRole('link', { name: 'Terminales POS' })).toHaveAttribute(
      'href',
      '/admin/pos-terminals',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar opciones de Compras' }));
    expect(screen.getByRole('link', { name: 'Proveedores' })).toHaveAttribute(
      'href',
      '/admin/suppliers',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar opciones de Ventas' }));
    expect(screen.getByRole('link', { name: 'Devoluciones' })).toHaveAttribute(
      'href',
      '/admin/returns',
    );
    expect(screen.getByRole('link', { name: 'Cierres de caja' })).toHaveAttribute(
      'href',
      '/admin/z-reports',
    );
  });

  it('keeps a fixed, scrollable sidebar and a non-overlapping content column', async () => {
    renderLayout();

    const account = await screen.findByRole('link', { name: 'Cuenta de Admin Uno' });
    const sidebar = screen.getByLabelText('Barra lateral');
    const navigation = screen.getByRole('navigation', { name: 'Navegación principal' });
    const main = screen.getByRole('main');

    expect(sidebar).toHaveClass('w-60', 'lg:w-64', 'shrink-0', 'overflow-hidden');
    expect(navigation).toHaveClass('overflow-y-auto');
    expect(main.parentElement).toHaveClass('min-w-0', 'overflow-hidden');
    expect(main).toHaveClass('overflow-y-auto');
    expect(account).toHaveAttribute('href', '/admin/account');
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });
});
