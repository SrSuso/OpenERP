import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '@/features/auth/AuthContext';
import { type Product } from '@/features/catalog/api';
import { type Incident } from '@/features/notifications/api';
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

const LOW_STOCK_PRODUCT: Product = {
  id: 10,
  sku: 'P000010',
  name: 'Leche',
  description: '',
  category_id: null,
  category_name: null,
  pos_category_id: null,
  pos_category_name: null,
  pos_display_order: 0,
  is_open_price: false,
  is_sold_by_weight: false,
  base_unit_name: 'UDS.',
  cost: '0.700000',
  list_price: '1.000000',
  tax_rate: '4.000000',
  surcharge_rate: '0.000000',
  effective_tax_rate: '4.000000',
  margin_rate: null,
  margin_amount: null,
  taxes: [],
  price_formula: null,
  min_stock: '5.000000',
  track_lots: false,
  track_expiration: false,
  tracks_stock: true,
  effective_tracks_stock: true,
  is_active: true,
  packages: [],
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

const LOT_INCIDENT: Incident = {
  id: 30,
  rule_id: 4,
  rule_name: 'Caducidad próxima',
  severity: 'MEDIUM_HIGH',
  subject_type: 'lot',
  subject_id: 5,
  message: 'El lote caduca pronto.',
  status: 'OPEN',
  first_detected_at: '2026-08-27T10:00:00Z',
  last_seen_at: '2026-08-27T10:00:00Z',
  resolved_at: null,
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
      if (url.includes('/products?')) {
        return Promise.resolve(jsonResponse(options.empty ? [] : [LOW_STOCK_PRODUCT]));
      }
      if (url.includes('/stock-balance/totals')) {
        return Promise.resolve(
          jsonResponse(options.empty ? [] : [{ product_id: 10, quantity: '2.000000' }]),
        );
      }
      if (url.includes('/purchase-orders?')) {
        return Promise.resolve(jsonResponse(options.empty ? [] : [PENDING_ORDER]));
      }
      if (url.includes('/incidents?status=OPEN')) {
        return Promise.resolve(jsonResponse(options.empty ? [] : [LOT_INCIDENT]));
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
    expect(screen.getByRole('heading', { name: 'Necesita atención' })).toBeInTheDocument();
    expect(screen.getByText('Productos con stock bajo')).toBeInTheDocument();
    expect(screen.getByText('Avisos sobre lotes')).toBeInTheDocument();
    expect(screen.getByText('Recepciones pendientes')).toBeInTheDocument();
    expect(screen.getByTestId('sales-chart')).toBeInTheDocument();
    expect(requestedUrls.some((url) => url.includes('/dashboards'))).toBe(false);
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
