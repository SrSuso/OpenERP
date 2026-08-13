import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// --- warehouses (phase 7) — only used here to scope a widget's query ------------

export const warehouseSchema = z.object({
  id: z.number(),
  name: z.string(),
  is_active: z.boolean(),
});
export type Warehouse = z.infer<typeof warehouseSchema>;

export const warehousesQuery = queryOptions({
  queryKey: ['dashboards', 'warehouses'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/warehouses`, { schema: z.array(warehouseSchema), signal }),
});

// --- metrics (the whitelist itself, phase 16) ------------------------------------

export const metricKeySchema = z.enum([
  'sales_over_time',
  'top_products',
  'stock_value',
  'low_stock_count',
]);
export type MetricKey = z.infer<typeof metricKeySchema>;

export const chartTypeSchema = z.enum(['kpi', 'line', 'bar', 'table']);
export type ChartType = z.infer<typeof chartTypeSchema>;

export const metricDescriptorSchema = z.object({
  key: metricKeySchema,
  params_schema: z.record(z.unknown()),
});
export type MetricDescriptor = z.infer<typeof metricDescriptorSchema>;

export const metricsQuery = queryOptions({
  queryKey: ['dashboards', 'metrics'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/dashboard-metrics`, {
      schema: z.array(metricDescriptorSchema),
      signal,
    }),
});

// --- dashboards / widgets ---------------------------------------------------------

export const widgetSchema = z.object({
  id: z.number(),
  dashboard_id: z.number(),
  metric: metricKeySchema,
  title: z.string(),
  params: z.record(z.unknown()),
  chart_type: chartTypeSchema,
  display_order: z.number(),
});
export type Widget = z.infer<typeof widgetSchema>;

export const dashboardSchema = z.object({
  id: z.number(),
  name: z.string(),
  owner_user_id: z.number().nullable(),
  widgets: z.array(widgetSchema),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

/** The backend derives ownership from the authenticated session.  The user id
 * is part of the client key only: it prevents an A -> B auth transition from
 * rendering A's cached collection while B's request is in flight. */
export function dashboardsQuery(ownerUserId: number) {
  return queryOptions({
    queryKey: ['dashboards', 'owner', ownerUserId] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/dashboards`, { schema: z.array(dashboardSchema), signal }),
  });
}

export async function createDashboard(name: string): Promise<Dashboard> {
  return apiFetch(`${API_V1}/dashboards`, {
    method: 'POST',
    schema: dashboardSchema,
    body: { name },
  });
}

export interface WidgetCreate {
  metric: MetricKey;
  title: string;
  params: Record<string, unknown>;
  chart_type: ChartType;
}

export async function addWidget(dashboardId: number, widget: WidgetCreate): Promise<Dashboard> {
  return apiFetch(`${API_V1}/dashboards/${dashboardId}/widgets`, {
    method: 'POST',
    schema: dashboardSchema,
    body: widget,
  });
}

export async function removeWidget(dashboardId: number, widgetId: number): Promise<Dashboard> {
  return apiFetch(`${API_V1}/dashboards/${dashboardId}/widgets/${widgetId}`, {
    method: 'DELETE',
    schema: dashboardSchema,
  });
}

// --- widget data (runs the metric live, phase 16) --------------------------------

const widgetDataSchema = z.object({ data: z.unknown() });

export function widgetDataQuery(dashboardId: number, widgetId: number) {
  return queryOptions({
    queryKey: ['dashboards', dashboardId, 'widgets', widgetId, 'data'] as const,
    queryFn: async ({ signal }) => {
      const result = await apiFetch(
        `${API_V1}/dashboards/${dashboardId}/widgets/${widgetId}/data`,
        { schema: widgetDataSchema, signal },
      );
      return result.data;
    },
  });
}

// --- typed shapes of each metric's `data` --------------------------------------

export const salesOverTimePointSchema = z.object({
  date: z.string(),
  sales_count: z.number(),
  total: z.string(),
});
export type SalesOverTimePoint = z.infer<typeof salesOverTimePointSchema>;

export const topProductRowSchema = z.object({
  product_id: z.number(),
  product_sku: z.string(),
  product_name: z.string(),
  quantity: z.string(),
  revenue: z.string(),
});
export type TopProductRow = z.infer<typeof topProductRowSchema>;

export const stockValueDataSchema = z.object({ stock_value: z.string() });
export const lowStockCountDataSchema = z.object({ low_stock_count: z.number() });
