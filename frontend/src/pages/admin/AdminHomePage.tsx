import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { AddWidgetForm } from '@/features/dashboards/AddWidgetForm';
import {
  addWidget,
  createDashboard,
  dashboardsQuery,
  removeWidget,
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
  const health = useQuery(healthQuery);
  const dashboards = useQuery(dashboardsQuery);
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);

  const createDashboardMutation = useMutation({
    mutationFn: () => createDashboard('Mi panel'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: dashboardsQuery.queryKey }),
  });

  const dashboard = dashboards.data?.[0];
  const dashboardReady = dashboards.isSuccess;

  if (dashboardReady && dashboard === undefined && createDashboardMutation.isIdle) {
    createDashboardMutation.mutate();
  }

  const addWidgetMutation = useMutation({
    mutationFn: (widget: WidgetCreate) => addWidget(dashboard!.id, widget),
    onSuccess: (updated) => {
      queryClient.setQueryData(dashboardsQuery.queryKey, [updated]);
      setShowAddForm(false);
    },
  });

  const removeWidgetMutation = useMutation({
    mutationFn: (widgetId: number) => removeWidget(dashboard!.id, widgetId),
    onSuccess: (updated) => queryClient.setQueryData(dashboardsQuery.queryKey, [updated]),
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
          <h2 className="text-lg font-semibold text-slate-800">Mi panel</h2>
          {dashboard && !showAddForm && (
            <button type="button" onClick={() => setShowAddForm(true)} className={primaryAction}>
              Añadir widget
            </button>
          )}
        </div>

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
