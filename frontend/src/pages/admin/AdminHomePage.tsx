import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router';

import { Alert, Button, Card, EmptyState, PageHeader } from '@/components/ui';
import { useAuth } from '@/features/auth/useAuth';
import { productsQuery } from '@/features/catalog/api';
import { type SalesOverTimePoint } from '@/features/dashboards/api';
import { SalesOverTimeChart } from '@/features/dashboards/SalesOverTimeChart';
import { stockTotalsQuery } from '@/features/inventory/api';
import { incidentsQuery } from '@/features/notifications/api';
import { purchaseOrdersQuery } from '@/features/purchasing/api';
import { runReport } from '@/features/reports/api';
import { useBusinessTimezone } from '@/features/settings/useShopSettings';
import { businessDateAt } from '@/lib/businessTime';
import { formatMoney } from '@/lib/format';

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return shifted.toISOString().slice(0, 10);
}

function datesBetween(dateFrom: string, dateTo: string): string[] {
  const dates: string[] = [];
  for (let date = dateFrom; date <= dateTo; date = shiftDate(date, 1)) dates.push(date);
  return dates;
}

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function numericValue(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  isPending: boolean;
  isError: boolean;
  to?: string;
  warning?: boolean;
}

function MetricCard({
  label,
  value,
  detail,
  isPending,
  isError,
  to,
  warning = false,
}: MetricCardProps) {
  return (
    <Card className="flex min-h-40 flex-col p-5">
      <p className="text-sm font-semibold text-slate-600">{label}</p>
      <div className="mt-3 flex-1">
        {isPending && <p className="text-sm text-slate-500">Cargando…</p>}
        {isError && <p className="text-sm font-medium text-red-700">No disponible</p>}
        {!isPending && !isError && (
          <>
            <p
              className={`text-3xl font-bold tracking-tight ${warning ? 'text-amber-700' : 'text-slate-950'}`}
            >
              {value}
            </p>
            <p className="mt-1 text-sm text-slate-500">{detail}</p>
          </>
        )}
      </div>
      {to && !isPending && !isError && (
        <NavLink
          to={to}
          className="mt-4 w-fit rounded text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          Ver detalle
        </NavLink>
      )}
    </Card>
  );
}

interface AttentionItemProps {
  label: string;
  count: number;
  detail: string;
  to: string;
}

function AttentionItem({ label, count, detail, to }: AttentionItemProps) {
  return (
    <li>
      <NavLink
        to={to}
        className="group flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-4 py-3 hover:border-brand-200 hover:bg-brand-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <span className="min-w-0">
          <span className="block font-semibold text-slate-800 group-hover:text-brand-700">
            {label}
          </span>
          <span className="mt-0.5 block text-sm text-slate-500">{detail}</span>
        </span>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-900">
          {count}
        </span>
      </NavLink>
    </li>
  );
}

/** Fixed operational overview. The configurable-dashboard backend remains
 * available for compatibility, but the store home no longer exposes its
 * technical builder or asks an operator to design their own starting page. */
export function AdminHomePage() {
  const { hasPermission } = useAuth();
  const timezone = useBusinessTimezone();
  const today = businessDateAt(timezone);
  const dateFrom = shiftDate(today, -6);

  const canSeeSales = hasPermission('report.read');
  const salesDetailRoute = hasPermission('sale.read') ? '/admin/sales' : '/admin/reports';
  const canSeeInventory = hasPermission('product.read') && hasPermission('inventory.read');
  const canSeePurchasing = hasPermission('purchase.read');
  const canSeeIncidents = hasPermission('notification.read');

  const sales = useQuery({
    queryKey: ['admin-home', 'sales', dateFrom, today],
    queryFn: ({ signal }) =>
      runReport(
        {
          subject: 'SALES',
          dimensions: ['date'],
          metrics: ['revenue', 'tickets'],
          filters: { date_from: dateFrom, date_to: today },
        },
        signal,
      ),
    enabled: canSeeSales,
  });
  const products = useQuery({
    ...productsQuery({ activeOnly: true }),
    enabled: canSeeInventory,
  });
  const stockTotals = useQuery({ ...stockTotalsQuery, enabled: canSeeInventory });
  const purchaseOrders = useQuery({
    ...purchaseOrdersQuery({}),
    enabled: canSeePurchasing,
  });
  const incidents = useQuery({
    ...incidentsQuery({ status: 'OPEN' }),
    enabled: canSeeIncidents,
  });

  const salesRows = sales.data?.rows ?? [];
  const todaySales = salesRows.find((row) => row.date === today);
  const todayRevenue = numericValue(todaySales?.revenue);
  const todayOperations = numericValue(todaySales?.tickets);
  const salesPoints: SalesOverTimePoint[] = datesBetween(dateFrom, today).map((date) => {
    const row = salesRows.find((item) => item.date === date);
    return {
      date: dateLabel(date),
      sales_count: numericValue(row?.tickets),
      total: String(numericValue(row?.revenue)),
    };
  });
  const hasRecentSales = salesRows.some((row) => numericValue(row.revenue) > 0);

  const stockByProduct = new Map(
    (stockTotals.data ?? []).map((total) => [total.product_id, numericValue(total.quantity)]),
  );
  const lowStockCount = (products.data ?? []).filter(
    (product) =>
      product.effective_tracks_stock &&
      numericValue(product.min_stock) > 0 &&
      (stockByProduct.get(product.id) ?? 0) < numericValue(product.min_stock),
  ).length;
  const inventoryPending = products.isPending || stockTotals.isPending;
  const inventoryError = products.isError || stockTotals.isError;

  const pendingReceipts = (purchaseOrders.data ?? []).filter((order) =>
    ['ORDERED', 'PARTIALLY_RECEIVED'].includes(order.status),
  ).length;
  const openIncidents = incidents.data ?? [];
  const lotIncidents = openIncidents.filter((incident) => incident.subject_type === 'lot').length;

  const attentionItems = [
    ...(canSeeInventory && !inventoryPending && !inventoryError && lowStockCount > 0
      ? [
          {
            label: 'Productos con stock bajo',
            count: lowStockCount,
            detail: 'Necesitan reposición o revisar su stock mínimo.',
            to: '/admin/inventory/products',
          },
        ]
      : []),
    ...(canSeeIncidents && incidents.isSuccess && lotIncidents > 0
      ? [
          {
            label: 'Avisos sobre lotes',
            count: lotIncidents,
            detail: 'Revisa caducidades y condiciones configuradas para lotes.',
            to: '/admin/notifications',
          },
        ]
      : []),
    ...(canSeePurchasing && purchaseOrders.isSuccess && pendingReceipts > 0
      ? [
          {
            label: 'Recepciones pendientes',
            count: pendingReceipts,
            detail: 'Pedidos enviados que todavía no se han recibido por completo.',
            to: '/admin/purchasing',
          },
        ]
      : []),
    ...(canSeeIncidents && incidents.isSuccess && openIncidents.length > 0
      ? [
          {
            label: 'Avisos abiertos',
            count: openIncidents.length,
            detail: 'Incidencias que siguen necesitando revisión.',
            to: '/admin/notifications',
          },
        ]
      : []),
  ];
  const attentionPending =
    (canSeeInventory && inventoryPending) ||
    (canSeePurchasing && purchaseOrders.isPending) ||
    (canSeeIncidents && incidents.isPending);
  const attentionError =
    (canSeeInventory && inventoryError) ||
    (canSeePurchasing && purchaseOrders.isError) ||
    (canSeeIncidents && incidents.isError);
  const hasAnyMetricPermission =
    canSeeSales || canSeeInventory || canSeePurchasing || canSeeIncidents;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Inicio"
        description="Resumen de la actividad de la tienda y de lo que necesita atención."
      />

      {!hasAnyMetricPermission && (
        <EmptyState
          title="No hay información operativa disponible"
          description="Tu perfil no tiene acceso a las métricas de ventas, inventario, compras o avisos."
        />
      )}

      {hasAnyMetricPermission && (
        <>
          <section aria-labelledby="today-heading">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="today-heading" className="text-lg font-bold text-slate-900">
                Hoy
              </h2>
              <p className="text-sm text-slate-500">Fecha comercial: {dateLabel(today)}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {canSeeSales && (
                <MetricCard
                  label="Ventas"
                  value={formatMoney(String(todayRevenue))}
                  detail={
                    todayRevenue > 0
                      ? 'Facturación confirmada hoy'
                      : 'Todavía no hay ventas registradas hoy'
                  }
                  isPending={sales.isPending}
                  isError={sales.isError}
                  to={salesDetailRoute}
                />
              )}
              {canSeeSales && (
                <MetricCard
                  label="Operaciones"
                  value={String(todayOperations)}
                  detail={
                    todayOperations === 1 ? 'Ticket completado hoy' : 'Tickets completados hoy'
                  }
                  isPending={sales.isPending}
                  isError={sales.isError}
                  to={salesDetailRoute}
                />
              )}
              {canSeeInventory && (
                <MetricCard
                  label="Stock bajo"
                  value={String(lowStockCount)}
                  detail={
                    lowStockCount > 0
                      ? 'Productos por debajo del mínimo'
                      : 'No hay productos con stock bajo'
                  }
                  isPending={inventoryPending}
                  isError={inventoryError}
                  to="/admin/inventory/products"
                  warning={lowStockCount > 0}
                />
              )}
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
            {canSeeSales && (
              <Card className="min-w-0 p-5 sm:p-6">
                <div className="mb-5">
                  <h2 className="text-lg font-bold text-slate-900">Ventas de los últimos 7 días</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Importe diario de ventas completadas.
                  </p>
                </div>
                {sales.isPending && (
                  <div
                    className="flex h-60 items-center justify-center text-sm text-slate-500"
                    aria-live="polite"
                  >
                    Cargando evolución de ventas…
                  </div>
                )}
                {sales.isError && (
                  <Alert tone="error">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span>No se ha podido cargar la evolución de ventas.</span>
                      <Button variant="secondary" onClick={() => void sales.refetch()}>
                        Reintentar
                      </Button>
                    </div>
                  </Alert>
                )}
                {sales.isSuccess && !hasRecentSales && (
                  <EmptyState title="No hay ventas registradas en los últimos 7 días" />
                )}
                {sales.isSuccess && hasRecentSales && <SalesOverTimeChart points={salesPoints} />}
              </Card>
            )}

            {(canSeeInventory || canSeePurchasing || canSeeIncidents) && (
              <Card className="p-5 sm:p-6">
                <div className="mb-5">
                  <h2 className="text-lg font-bold text-slate-900">Necesita atención</h2>
                  <p className="mt-1 text-sm text-slate-500">Asuntos pendientes de la tienda.</p>
                </div>
                {attentionPending && (
                  <p className="py-8 text-center text-sm text-slate-500" aria-live="polite">
                    Comprobando asuntos pendientes…
                  </p>
                )}
                {!attentionPending && attentionError && (
                  <Alert tone="error">No se ha podido cargar toda la información pendiente.</Alert>
                )}
                {!attentionPending && attentionItems.length === 0 && !attentionError && (
                  <EmptyState
                    title="No hay asuntos pendientes"
                    description="No hay stock bajo, recepciones ni avisos que requieran atención."
                  />
                )}
                {!attentionPending && attentionItems.length > 0 && (
                  <ul className="space-y-3">
                    {attentionItems.map((item) => (
                      <AttentionItem key={item.label} {...item} />
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
