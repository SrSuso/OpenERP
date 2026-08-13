import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import {
  warehousesQuery,
  type ChartType,
  type MetricKey,
  type WidgetCreate,
} from '@/features/dashboards/api';
import { useBusinessTimezone } from '@/features/settings/useShopSettings';
import { businessDateAt } from '@/lib/businessTime';

const METRIC_LABELS: Record<MetricKey, string> = {
  sales_over_time: 'Ventas por día',
  top_products: 'Productos más vendidos',
  stock_value: 'Valor del inventario',
  low_stock_count: 'Productos bajo mínimo',
};

/** The chart form each metric's data naturally takes — `chart_type` is
 * presentational only (see `app.dashboards.models`), so the form doesn't
 * offer choices that wouldn't make sense for the metric's own shape. */
const DEFAULT_CHART_TYPE: Record<MetricKey, ChartType> = {
  sales_over_time: 'line',
  top_products: 'bar',
  stock_value: 'kpi',
  low_stock_count: 'kpi',
};

function needsDateRange(metric: MetricKey): boolean {
  return metric === 'sales_over_time' || metric === 'top_products';
}

interface AddWidgetFormProps {
  onSubmit: (widget: WidgetCreate) => void;
  onCancel: () => void;
  isPending: boolean;
}

function shiftIsoDate(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
}

export function AddWidgetForm({ onSubmit, onCancel, isPending }: AddWidgetFormProps) {
  const warehouses = useQuery(warehousesQuery);
  const businessTimezone = useBusinessTimezone();
  const businessToday = businessDateAt(businessTimezone);

  const [metric, setMetric] = useState<MetricKey>('sales_over_time');
  const [title, setTitle] = useState(METRIC_LABELS.sales_over_time);
  // Null means "still use the live business-calendar default".  This lets
  // the configured timezone arrive after the form mounts without overwriting
  // a date the user has already edited.
  const [dateFromOverride, setDateFromOverride] = useState<string | null>(null);
  const [dateToOverride, setDateToOverride] = useState<string | null>(null);
  const dateFrom = dateFromOverride ?? shiftIsoDate(businessToday, -30);
  const dateTo = dateToOverride ?? businessToday;
  const [warehouseId, setWarehouseId] = useState('');
  const [orderBy, setOrderBy] = useState<'revenue' | 'quantity'>('revenue');
  const [limit, setLimit] = useState('10');

  function selectMetric(next: MetricKey) {
    setMetric(next);
    setTitle(METRIC_LABELS[next]);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const params: Record<string, unknown> = {};
    if (needsDateRange(metric)) {
      params['date_from'] = dateFrom;
      params['date_to'] = dateTo;
    }
    if (warehouseId !== '') {
      params['warehouse_id'] = Number(warehouseId);
    }
    if (metric === 'top_products') {
      params['order_by'] = orderBy;
      params['limit'] = Number(limit);
    }
    onSubmit({ metric, title, params, chart_type: DEFAULT_CHART_TYPE[metric] });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Añadir widget</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-600">
          Métrica
          <select
            value={metric}
            onChange={(event) => selectMetric(event.target.value as MetricKey)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {Object.entries(METRIC_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm text-slate-600">
          Título
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        {needsDateRange(metric) && (
          <>
            <label className="text-sm text-slate-600">
              Desde
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFromOverride(event.target.value)}
                required
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm text-slate-600">
              Hasta
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateToOverride(event.target.value)}
                required
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </>
        )}

        {metric === 'top_products' && (
          <>
            <label className="text-sm text-slate-600">
              Ordenar por
              <select
                value={orderBy}
                onChange={(event) => setOrderBy(event.target.value as 'revenue' | 'quantity')}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="revenue">Ingresos</option>
                <option value="quantity">Unidades</option>
              </select>
            </label>
            <label className="text-sm text-slate-600">
              Nº de productos
              <input
                type="number"
                min={1}
                max={50}
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </>
        )}

        <label className="text-sm text-slate-600">
          Almacén (opcional)
          <select
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            {warehouses.data?.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? 'Añadiendo…' : 'Añadir'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
