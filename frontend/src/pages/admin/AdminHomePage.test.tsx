import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '@/features/auth/AuthContext';
import { type ActiveAlert } from '@/features/notifications/api';
import { type PurchaseOrder } from '@/features/purchasing/api';
import { formatMoney } from '@/lib/format';

import { AdminHomePage } from './AdminHomePage';

vi.mock('@/features/dashboards/SalesOverTimeChart', () => ({
  SalesOverTimeChart: () => <div data-testid="sales-chart">Gráfica de ventas</div>,
}));

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const ALL_METRIC_PERMISSIONS = [
  'report.read',
  'product.read',
  'inventory.read',
  'purchase.read',
  'notification.read',
];

const USER = {
  id: 1,
  email: 'manager@example.com',
  full_name: 'Encargada Uno',
  role: 'MANAGER',
  permissions: ALL_METRIC_PERMISSIONS,
  must_change_password: false,
};

const PENDING_ORDER: PurchaseOrder = {
  id: 20,
  supplier_id: 2,
  supplier_name: 'Proveedor Uno',
  status: 'PARTIALLY_RECEIVED',
  notes: '',
  ordered_at: '2026-08-27T10:00:00Z',
  created_at: '2026-08-27T09:00:00Z',
  lines: [],
  total: '12.000000',
};

const LOT_ALERT: ActiveAlert = {
  id: 30,
  kind: 'EXPIRATION',
  title: 'Yogur',
  product_id: 5,
  stock_current: null,
  min_stock: null,
  replenish: null,
  lot_id: 5,
  lot_number: 'L-5',
  expiration_date: '2026-08-30',
  days_remaining: 2,
  quantity_remaining: '3',
};

const LOW_STOCK_ALERT: ActiveAlert = {
  ...LOT_ALERT,
  id: 29,
  kind: 'LOW_STOCK',
  title: 'Leche',
  product_id: 10,
  stock_current: '2',
  min_stock: '5',
  replenish: '3',
  lot_id: null,
  lot_number: null,
  expiration_date: null,
  days_remaining: null,
  quantity_remaining: null,
};

function authValue(permissions = ALL_METRIC_PERMISSIONS): AuthContextValue {
  const user = { ...USER, permissions };
  return {
    user,
    isLoading: false,
    hasPermission: (key) => permissions.includes(key),
    login: vi.fn(),
    logout: vi.fn(),
    markPasswordChanged: vi.fn(),
  };
}

function stubBackend(
  options: {
    empty?: boolean;
    reportError?: boolean;
    pendingReport?: boolean;
  } = {},
) {
  const requestedUrls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(url);

      if (url.includes('/settings/values')) {
        return Promise.resolve(jsonResponse({ 'business.timezone': 'Europe/Madrid' }));
      }
      if (url.includes('/reports/run')) {
        if (options.pendingReport) return new Promise<Response>(() => undefined);
        if (options.reportError) {
          return Promise.resolve(
            jsonResponse(
              { error: { code: 'internal_error', message: 'database connection detail' } },
              { status: 500 },
            ),
          );
        }
        if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
        const body = JSON.parse(init.body) as {
          filters: { date_from: string; date_to: string };
        };
        return Promise.resolve(
          jsonResponse({
            columns: ['date', 'revenue', 'tickets'],
            rows: options.empty
              ? []
              : [
                  {
                    date: body.filters.date_to,
                    revenue: '1248.320000',
                    tickets: 83,
                  },
                ],
          }),
        );
      }
      if (url.includes('/purchase-orders?')) {
        return Promise.resolve(jsonResponse(options.empty ? [] : [PENDING_ORDER]));
      }
      if (url.endsWith('/alerts')) {
        return Promise.resolve(jsonResponse(options.empty ? [] : [LOW_STOCK_ALERT, LOT_ALERT]));
      }
      return Promise.reject(new Error(`Unexpected fetch to ${url}`));
    }),
  );
  return requestedUrls;
}

function renderPage(permissions = ALL_METRIC_PERMISSIONS) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue(permissions)}>
        <MemoryRouter>
          <AdminHomePage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('AdminHomePage', () => {
  it('shows a fixed operational overview using existing APIs', async () => {
    const requestedUrls = stubBackend();
    renderPage();

    expect(await screen.findByText(formatMoney('1248.32'))).toBeInTheDocument();
    expect(screen.getByText('83')).toBeInTheDocument();
    const attentionHeading = screen.getByRole('heading', { name: 'Necesita atención' });
    const attentionCard = attentionHeading.parentElement?.parentElement;
    expect(attentionCard).not.toBeNull();
    expect(within(attentionCard!).getByText('Stock bajo')).toBeInTheDocument();
    expect(within(attentionCard!).getByText('Caducidades')).toBeInTheDocument();
    expect(within(attentionCard!).queryByText('Otros avisos')).not.toBeInTheDocument();
    expect(within(attentionCard!).getByText('Recepciones pendientes')).toBeInTheDocument();
    expect(within(attentionCard!).queryByText('Avisos abiertos')).not.toBeInTheDocument();
    expect(within(attentionCard!).queryByText('Avisos sobre lotes')).not.toBeInTheDocument();
    expect(screen.getByTestId('sales-chart')).toBeInTheDocument();
    expect(requestedUrls.some((url) => url.includes('/dashboards'))).toBe(false);
    expect(requestedUrls.some((url) => url.includes('/stock-balance/totals'))).toBe(false);
    expect(requestedUrls.some((url) => url.includes('/products?'))).toBe(false);
  });

  it('does not expose API health or dashboard and widget controls', async () => {
    stubBackend({ empty: true });
    renderPage();

    expect(
      await screen.findByText('No hay ventas registradas en los últimos 7 días'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/estado de la api/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/dashboard activo/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /añadir widget/i })).not.toBeInTheDocument();
    expect(screen.getByText('No hay asuntos pendientes')).toBeInTheDocument();
  });

  it('shows clear loading and error states without backend details', async () => {
    stubBackend({ pendingReport: true });
    const view = renderPage(['report.read']);
    expect(await screen.findByText('Cargando evolución de ventas…')).toBeInTheDocument();
    view.unmount();

    stubBackend({ reportError: true });
    renderPage(['report.read']);
    expect(
      await screen.findByText('No se ha podido cargar la evolución de ventas.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/database connection detail/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('does not request or render metrics without their permissions', async () => {
    const requestedUrls = stubBackend();
    renderPage([]);

    expect(await screen.findByText('No hay información operativa disponible')).toBeInTheDocument();
    expect(screen.queryByText('Ventas')).not.toBeInTheDocument();
    expect(screen.queryByText('Stock bajo')).not.toBeInTheDocument();
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain('/settings/values');
  });
});
