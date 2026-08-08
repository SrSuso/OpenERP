import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { type Dashboard, type Widget } from '@/features/dashboards/api';

import { AdminHomePage } from './AdminHomePage';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const HEALTH = { status: 'ok', app: 'OpenERP', environment: 'test' };

function emptyDashboard(id: number): Dashboard {
  return { id, name: 'Mi panel', owner_user_id: 1, widgets: [] };
}

/** A minimal stand-in backend, tracked so tests can assert on how many
 * times a mutating endpoint was hit — same style as
 * `frontend/src/pages/pos/PosHomePage.test.tsx`. */
function stubBackend(options: { existingDashboard?: Dashboard } = {}) {
  let dashboard: Dashboard | null = options.existingDashboard ?? null;
  let nextWidgetId = 1;
  const createDashboardCalls = { count: 0 };

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/health/live')) {
        return Promise.resolve(jsonResponse(HEALTH));
      }
      if (url.includes('/warehouses')) {
        return Promise.resolve(
          jsonResponse([{ id: 1, name: 'Tienda principal', is_active: true }]),
        );
      }
      if (method === 'GET' && /\/dashboards$/.test(url)) {
        return Promise.resolve(jsonResponse(dashboard ? [dashboard] : []));
      }
      if (method === 'POST' && /\/dashboards$/.test(url)) {
        createDashboardCalls.count += 1;
        dashboard = emptyDashboard(1);
        return Promise.resolve(jsonResponse(dashboard, { status: 201 }));
      }
      if (method === 'POST' && /\/dashboards\/\d+\/widgets$/.test(url)) {
        const body = init?.body ? (JSON.parse(init.body as string) as Partial<Widget>) : {};
        const widget: Widget = {
          id: nextWidgetId++,
          dashboard_id: dashboard!.id,
          metric: body.metric!,
          title: body.title!,
          params: body.params ?? {},
          chart_type: body.chart_type!,
          display_order: 0,
        };
        dashboard = { ...dashboard!, widgets: [...dashboard!.widgets, widget] };
        return Promise.resolve(jsonResponse(dashboard, { status: 201 }));
      }
      if (method === 'DELETE' && /\/dashboards\/\d+\/widgets\/\d+$/.test(url)) {
        dashboard = { ...dashboard!, widgets: [] };
        return Promise.resolve(jsonResponse(dashboard));
      }
      if (method === 'GET' && /\/widgets\/\d+\/data$/.test(url)) {
        return Promise.resolve(jsonResponse({ data: { stock_value: '0.000000' } }));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { createDashboardCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminHomePage />
    </QueryClientProvider>,
  );
}

describe('AdminHomePage', () => {
  it('shows the API health status', async () => {
    stubBackend();
    renderPage();

    expect(await screen.findByText('ok · OpenERP · test')).toBeInTheDocument();
  });

  it('creates a default dashboard when none exists yet', async () => {
    const backend = stubBackend();
    renderPage();

    await screen.findByText(/todavía no hay widgets/i);

    expect(backend.createDashboardCalls.count).toBe(1);
  });

  it('does not create a second dashboard when one already exists', async () => {
    const backend = stubBackend({ existingDashboard: emptyDashboard(7) });
    renderPage();

    await screen.findByText(/todavía no hay widgets/i);

    expect(backend.createDashboardCalls.count).toBe(0);
  });

  it('adding a widget shows it on the dashboard', async () => {
    stubBackend({ existingDashboard: emptyDashboard(7) });
    renderPage();
    await screen.findByText(/todavía no hay widgets/i);

    await userEvent.click(screen.getByRole('button', { name: /añadir widget/i }));
    await userEvent.selectOptions(screen.getByLabelText(/métrica/i), 'Valor del inventario');
    await userEvent.click(screen.getByRole('button', { name: /^añadir$/i }));

    expect(await screen.findByText('Valor del inventario')).toBeInTheDocument();
    expect(screen.queryByText(/todavía no hay widgets/i)).not.toBeInTheDocument();
  });

  it('removing the only widget shows the empty state again', async () => {
    const dashboardWithWidget: Dashboard = {
      ...emptyDashboard(7),
      widgets: [
        {
          id: 1,
          dashboard_id: 7,
          metric: 'stock_value',
          title: 'Valor de inventario',
          params: {},
          chart_type: 'kpi',
          display_order: 0,
        },
      ],
    };
    stubBackend({ existingDashboard: dashboardWithWidget });
    renderPage();
    await screen.findByText('Valor de inventario');

    await userEvent.click(screen.getByRole('button', { name: /quitar valor de inventario/i }));

    expect(await screen.findByText(/todavía no hay widgets/i)).toBeInTheDocument();
  });
});
