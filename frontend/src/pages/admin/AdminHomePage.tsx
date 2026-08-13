import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useAuth } from '@/features/auth/useAuth';
import { AddWidgetForm } from '@/features/dashboards/AddWidgetForm';
import {
  addWidget,
  createDashboard,
  dashboardsQuery,
  removeWidget,
  type Dashboard,
  type WidgetCreate,
} from '@/features/dashboards/api';
import { Widget } from '@/features/dashboards/Widget';
import { healthQuery } from '@/features/health/api';

import { pageTitleRow, primaryAction } from './pageActions';

/**
 * The admin home is the default dashboard (phase 16): a saved arrangement
 * of widgets, each running one metric from the whitelist in
 * `app.dashboards.metrics` live, on every visit — nothing here is ever
 * cached data quietly going stale.
 */
export function AdminHomePage() {
  const { user } = useAuth();
  const health = useQuery(healthQuery);
  const dashboardQuery = dashboardsQuery(user?.id ?? 0);
  const dashboards = useQuery({ ...dashboardQuery, enabled: user != null });
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeDashboardId, setActiveDashboardId] = useState<number | null>(null);

  const cacheDashboard = (updated: Dashboard) => {
    queryClient.setQueryData<Dashboard[]>(dashboardQuery.queryKey, (current = []) => {
      const exists = current.some((dashboard) => dashboard.id === updated.id);
      return exists
        ? current.map((dashboard) => (dashboard.id === updated.id ? updated : dashboard))
        : [...current, updated];
    });
  };

  const createDashboardMutation = useMutation({
    mutationFn: () => createDashboard('Mi panel'),
    onSuccess: cacheDashboard,
  });

  useEffect(() => {
    const available = dashboards.data ?? [];
    setActiveDashboardId((current) =>
      current !== null && available.some((dashboard) => dashboard.id === current)
        ? current
        : (available[0]?.id ?? null),
    );
  }, [dashboards.data, user?.id]);

  const dashboard = dashboards.data?.find((item) => item.id === activeDashboardId);
  const dashboardReady = dashboards.isSuccess;

  if (dashboardReady && dashboards.data.length === 0 && createDashboardMutation.isIdle) {
    createDashboardMutation.mutate();
  }

  const addWidgetMutation = useMutation({
    mutationFn: (widget: WidgetCreate) => addWidget(dashboard!.id, widget),
    onSuccess: (updated) => {
      cacheDashboard(updated);
      setShowAddForm(false);
    },
  });

  const removeWidgetMutation = useMutation({
    mutationFn: (widgetId: number) => removeWidget(dashboard!.id, widgetId),
    onSuccess: cacheDashboard,
  });

  return (
    <section>
      <h1 className="text-2xl font-semibold">Panel de administración</h1>

      <dl className="mt-4 max-w-sm rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <dt className="font-medium text-slate-500">Estado de la API</dt>
        <dd className="mt-1" data-testid="api-status">
          {health.isPending && 'Comprobando…'}
          {health.isError && `Sin conexión (${health.error.message})`}
          {health.data && `${health.data.status} · ${health.data.app} · ${health.data.environment}`}
        </dd>
      </dl>

      <div className="mt-8">
        <div className={pageTitleRow}>
          <h2 className="text-lg font-semibold text-slate-800">{dashboard?.name ?? 'Mi panel'}</h2>
          {dashboard && !showAddForm && (
            <button type="button" onClick={() => setShowAddForm(true)} className={primaryAction}>
              Añadir widget
            </button>
          )}
        </div>

        {dashboards.data && dashboards.data.length > 1 && (
          <label className="mb-4 block max-w-xs text-sm text-slate-600">
            Dashboard activo
            <select
              aria-label="Dashboard activo"
              value={activeDashboardId ?? ''}
              onChange={(event) => {
                setActiveDashboardId(Number(event.target.value));
                setShowAddForm(false);
              }}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              {dashboards.data.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {!dashboard && <p className="text-sm text-slate-500">Preparando el panel…</p>}

        {dashboard && showAddForm && (
          <AddWidgetForm
            isPending={addWidgetMutation.isPending}
            onCancel={() => setShowAddForm(false)}
            onSubmit={(widget) => addWidgetMutation.mutate(widget)}
          />
        )}

        {dashboard && dashboard.widgets.length === 0 && !showAddForm && (
          <p className="text-sm text-slate-500">
            Todavía no hay widgets. Toca «Añadir widget» para elegir una métrica.
          </p>
        )}

        {dashboard && dashboard.widgets.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dashboard.widgets.map((widget) => (
              <Widget
                key={widget.id}
                dashboardId={dashboard.id}
                widget={widget}
                isRemoving={removeWidgetMutation.isPending}
                onRemove={() => removeWidgetMutation.mutate(widget.id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
