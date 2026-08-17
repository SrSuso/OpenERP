import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '@/features/auth/AuthContext';
import { dashboardsQuery, type Dashboard, type Widget } from '@/features/dashboards/api';

import { AdminHomePage } from './AdminHomePage';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const USER_A = {
  id: 1,
  email: 'admin-a@example.com',
  full_name: 'Admin A',
  role: 'ADMIN',
  permissions: ['admin.access', 'dashboard.read', 'dashboard.manage'],
  must_change_password: false,
};
const USER_B = { ...USER_A, id: 2, email: 'admin-b@example.com', full_name: 'Admin B' };

function emptyDashboard(id: number, name = 'Mi panel', ownerUserId = 1): Dashboard {
  return { id, name, owner_user_id: ownerUserId, widgets: [] };
}

function authValue(user = USER_A): AuthContextValue {
  return {
    user,
    isLoading: false,
    hasPermission: (key) => user.permissions.includes(key),
    login: vi.fn(),
    logout: vi.fn(),
    markPasswordChanged: vi.fn(),
  };
}

/** A minimal stand-in backend, tracked so tests can assert on how many
 * times a mutating endpoint was hit — same style as
 * `frontend/src/pages/pos/PosHomePage.test.tsx`. */
function stubBackend(
  options: {
    existingDashboard?: Dashboard;
    existingDashboards?: Dashboard[];
    rejectWidgetForDashboardId?: number;
  } = {},
) {
  let dashboards: Dashboard[] =
    options.existingDashboards ?? (options.existingDashboard ? [options.existingDashboard] : []);
  let nextWidgetId = 1;
  const createDashboardCalls = { count: 0 };

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/auth/me')) {
        return Promise.resolve(jsonResponse(USER_A));
      }
      if (url.includes('/warehouses')) {
        return Promise.resolve(
          jsonResponse([{ id: 1, name: 'Tienda principal', is_active: true }]),
        );
      }
      if (method === 'GET' && /\/dashboards$/.test(url)) {
        return Promise.resolve(jsonResponse(dashboards));
      }
      if (method === 'POST' && /\/dashboards$/.test(url)) {
        createDashboardCalls.count += 1;
        const dashboard = emptyDashboard(Math.max(0, ...dashboards.map((item) => item.id)) + 1);
        dashboards = [...dashboards, dashboard];
        return Promise.resolve(jsonResponse(dashboard, { status: 201 }));
      }
      if (method === 'POST' && /\/dashboards\/\d+\/widgets$/.test(url)) {
        const dashboardId = Number(/\/dashboards\/(\d+)\/widgets$/.exec(url)![1]);
        if (dashboardId === options.rejectWidgetForDashboardId) {
          return Promise.resolve(
            jsonResponse(
              { error: { code: 'not_found', message: 'Dashboard not found.' } },
              { status: 404 },
            ),
          );
        }
        const body = init?.body ? (JSON.parse(init.body as string) as Partial<Widget>) : {};
        const widget: Widget = {
          id: nextWidgetId++,
          dashboard_id: dashboardId,
          metric: body.metric!,
          title: body.title!,
          params: body.params ?? {},
          chart_type: body.chart_type!,
          display_order: 0,
        };
        const dashboard = dashboards.find((item) => item.id === dashboardId)!;
        const updated = { ...dashboard, widgets: [...dashboard.widgets, widget] };
        dashboards = dashboards.map((item) => (item.id === dashboardId ? updated : item));
        return Promise.resolve(jsonResponse(updated, { status: 201 }));
      }
      if (method === 'DELETE' && /\/dashboards\/\d+\/widgets\/\d+$/.test(url)) {
        const dashboardId = Number(/\/dashboards\/(\d+)\/widgets\/\d+$/.exec(url)![1]);
        const dashboard = dashboards.find((item) => item.id === dashboardId)!;
        const updated = { ...dashboard, widgets: [] };
        dashboards = dashboards.map((item) => (item.id === dashboardId ? updated : item));
        return Promise.resolve(jsonResponse(updated));
      }
      if (method === 'GET' && /\/widgets\/\d+\/data$/.test(url)) {
        return Promise.resolve(jsonResponse({ data: { stock_value: '0.000000' } }));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return {
    createDashboardCalls,
    setDashboards(next: Dashboard[]) {
      dashboards = next;
    },
  };
}

function renderPage(user = USER_A) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue(user)}>
        <AdminHomePage />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe('AdminHomePage', () => {
  it('shows the API health status', async () => {
    stubBackend();
    renderPage();

    expect(await screen.findByText('ok · OpenERP · sesión autenticada')).toBeInTheDocument();
  });

  it('creates a default dashboard when none exists yet', async () => {
    const backend = stubBackend();
    const { queryClient } = renderPage();

    await screen.findByText(/todavía no hay widgets/i);

    expect(backend.createDashboardCalls.count).toBe(1);
    expect(queryClient.getQueryData<Dashboard[]>(dashboardsQuery(USER_A.id).queryKey)).toHaveLength(
      1,
    );
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

  it('keeps every dashboard in cache when one is edited', async () => {
    const first = emptyDashboard(7, 'Principal');
    const second = emptyDashboard(8, 'Operaciones');
    stubBackend({ existingDashboards: [first, second] });
    const { queryClient } = renderPage();
    await screen.findByRole('combobox', { name: /dashboard activo/i });

    await userEvent.click(screen.getByRole('button', { name: /añadir widget/i }));
    await userEvent.selectOptions(screen.getByLabelText(/métrica/i), 'Valor del inventario');
    await userEvent.click(screen.getByRole('button', { name: /^añadir$/i }));
    await screen.findByText('Valor del inventario');

    const cached = queryClient.getQueryData<Dashboard[]>(dashboardsQuery(USER_A.id).queryKey);
    expect(cached?.map((dashboard) => dashboard.id)).toEqual([7, 8]);
    expect(cached?.find((dashboard) => dashboard.id === 7)?.widgets).toHaveLength(1);
    expect(cached?.find((dashboard) => dashboard.id === 8)?.widgets).toHaveLength(0);
  });

  it('keeps the selected dashboard active after a refetch', async () => {
    stubBackend({
      existingDashboards: [emptyDashboard(7, 'Principal'), emptyDashboard(8, 'Operaciones')],
    });
    const { queryClient } = renderPage();
    const selector = await screen.findByRole('combobox', { name: /dashboard activo/i });
    await userEvent.selectOptions(selector, 'Operaciones');
    expect(selector).toHaveValue('8');

    await queryClient.invalidateQueries({ queryKey: dashboardsQuery(USER_A.id).queryKey });

    expect(await screen.findByRole('combobox', { name: /dashboard activo/i })).toHaveValue('8');
    expect(screen.getByRole('heading', { name: 'Operaciones' })).toBeInTheDocument();
  });

  it('never shows user A cache while user B dashboards load', async () => {
    const backend = stubBackend({ existingDashboards: [emptyDashboard(7, 'Panel A')] });
    const { queryClient, rerender } = renderPage(USER_A);
    expect(await screen.findByRole('heading', { name: 'Panel A' })).toBeInTheDocument();

    backend.setDashboards([emptyDashboard(9, 'Panel B', USER_B.id)]);
    rerender(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authValue(USER_B)}>
          <AdminHomePage />
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('heading', { name: 'Panel A' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Panel B' })).toBeInTheDocument();
  });

  it('does not alter the collection when a foreign dashboard mutation returns 404', async () => {
    const first = emptyDashboard(7, 'Principal');
    const second = emptyDashboard(8, 'Operaciones');
    stubBackend({ existingDashboards: [first, second], rejectWidgetForDashboardId: first.id });
    const { queryClient } = renderPage();
    await screen.findByRole('combobox', { name: /dashboard activo/i });

    await userEvent.click(screen.getByRole('button', { name: /añadir widget/i }));
    await userEvent.selectOptions(screen.getByLabelText(/métrica/i), 'Valor del inventario');
    await userEvent.click(screen.getByRole('button', { name: /^añadir$/i }));

    const cached = queryClient.getQueryData<Dashboard[]>(dashboardsQuery(USER_A.id).queryKey);
    expect(cached).toEqual([first, second]);
  });
});
