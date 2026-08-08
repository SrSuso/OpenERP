import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import {
  lowStockCountDataSchema,
  salesOverTimePointSchema,
  stockValueDataSchema,
  topProductRowSchema,
  widgetDataQuery,
  type Widget as WidgetModel,
} from '@/features/dashboards/api';
import { KpiTile } from '@/features/dashboards/KpiTile';
import { SalesOverTimeChart } from '@/features/dashboards/SalesOverTimeChart';
import { TopProductsChart } from '@/features/dashboards/TopProductsChart';
import { formatMoney } from '@/lib/format';

interface WidgetProps {
  dashboardId: number;
  widget: WidgetModel;
  onRemove: () => void;
  isRemoving: boolean;
}

/** Renders whatever `widget.metric`'s data actually is — chart_type alone
 * is presentational (phase 16's own docstring: it "never changes what
 * gets queried"), so this still validates the shape per metric before
 * handing it to a chart. */
function WidgetBody({ metric, data }: { metric: WidgetModel['metric']; data: unknown }) {
  switch (metric) {
    case 'sales_over_time': {
      const points = z.array(salesOverTimePointSchema).parse(data);
      if (points.length === 0) {
        return <p className="text-sm text-slate-500">Sin ventas en el rango elegido.</p>;
      }
      return <SalesOverTimeChart points={points} />;
    }
    case 'top_products': {
      const rows = z.array(topProductRowSchema).parse(data);
      if (rows.length === 0) {
        return <p className="text-sm text-slate-500">Sin ventas en el rango elegido.</p>;
      }
      // Whichever value the API actually ordered by is the one with the
      // widest spread across rows — a light heuristic, good enough to
      // pick the axis the chart should read against.
      const orderBy = rows[0]!.revenue !== rows[rows.length - 1]!.revenue ? 'revenue' : 'quantity';
      return <TopProductsChart rows={rows} orderBy={orderBy} />;
    }
    case 'stock_value': {
      const { stock_value: value } = stockValueDataSchema.parse(data);
      return <KpiTile value={formatMoney(value)} />;
    }
    case 'low_stock_count': {
      const { low_stock_count: count } = lowStockCountDataSchema.parse(data);
      return (
        <KpiTile
          value={String(count)}
          {...(count > 0
            ? { status: 'warning' as const, statusLabel: 'por debajo del mínimo' }
            : {})}
        />
      );
    }
  }
}

export function Widget({ dashboardId, widget, onRemove, isRemoving }: WidgetProps) {
  const { data, isPending, isError } = useQuery(widgetDataQuery(dashboardId, widget.id));

  return (
    <div className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">{widget.title}</h3>
        <button
          type="button"
          onClick={onRemove}
          disabled={isRemoving}
          aria-label={`Quitar ${widget.title}`}
          className="shrink-0 text-slate-400 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ✕
        </button>
      </div>

      {isPending && <p className="text-sm text-slate-400">Cargando…</p>}
      {isError && <p className="text-sm text-red-600">No se han podido cargar los datos.</p>}
      {data !== undefined && <WidgetBody metric={widget.metric} data={data} />}
    </div>
  );
}
