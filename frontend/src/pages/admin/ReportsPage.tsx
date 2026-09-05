import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/features/auth/useAuth';
import { productCategoriesQuery, productsQuery } from '@/features/catalog/api';
import { warehousesQuery } from '@/features/inventory/api';
import { ReportResultTable } from '@/features/reports/ReportResultTable';
import {
  createReportDefinition,
  deleteReportDefinition,
  reportDefinitionsQuery,
  reportSubjectsQuery,
  runReport,
  runReportDefinition,
  type ReportFilters,
  type ReportRunRequest,
  type ReportRunResult,
  type ReportSubject,
} from '@/features/reports/api';
import { suppliersQuery } from '@/features/suppliers/api';

const MOVEMENT_TYPES: Record<string, string> = {
  PURCHASE_RECEIPT: 'Recepción de compra',
  SALE: 'Venta',
  ADJUSTMENT: 'Ajuste',
  WASTE: 'Merma',
  TRANSFER_OUT: 'Transferencia (salida)',
  TRANSFER_IN: 'Transferencia (entrada)',
  RETURN: 'Devolución',
};

interface QuickReport {
  id: string;
  title: string;
  description: string;
  subject: ReportSubject;
  dimensions: string[];
  metrics: string[];
  filters: ReportFilters;
}

function madridDate(): string {
  const madrid = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    madrid.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function quickReports(): QuickReport[] {
  const today = madridDate();
  return [
    {
      id: 'sales-today',
      title: 'Ventas de hoy',
      description: 'Facturación, tickets y unidades vendidas durante la jornada actual.',
      subject: 'SALES',
      dimensions: [],
      metrics: ['revenue', 'tickets', 'quantity'],
      filters: { date_from: today, date_to: today },
    },
    {
      id: 'products-today',
      title: 'Productos vendidos hoy',
      description: 'Unidades e ingresos por artículo de la jornada actual.',
      subject: 'SALES',
      dimensions: ['product'],
      metrics: ['quantity', 'revenue'],
      filters: { date_from: today, date_to: today },
    },
    {
      id: 'categories-today',
      title: 'Ventas por categoría',
      description: 'Qué categorías han generado las ventas de hoy.',
      subject: 'SALES',
      dimensions: ['category'],
      metrics: ['revenue', 'quantity', 'tickets'],
      filters: { date_from: today, date_to: today },
    },
    {
      id: 'purchases-month',
      title: 'Compras del mes',
      description: 'Coste y unidades compradas, agrupados por proveedor.',
      subject: 'PURCHASES',
      dimensions: ['supplier'],
      metrics: ['cost', 'quantity', 'orders'],
      filters: { date_from: `${today.slice(0, 8)}01`, date_to: today },
    },
    {
      id: 'inventory-today',
      title: 'Movimientos de hoy',
      description: 'Entradas, ventas, devoluciones y ajustes de inventario.',
      subject: 'INVENTORY_MOVEMENTS',
      dimensions: ['movement_type'],
      metrics: ['quantity', 'movements'],
      filters: { date_from: today, date_to: today },
    },
  ];
}

function toggleInSet(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** `/admin/reports` — gated por `report.read`; guardar/eliminar informes
 * necesita `report.manage`. Constructor a medida: sujeto → dimensiones →
 * métricas → filtros, todo tomado de la lista blanca que expone
 * GET /report-subjects (backend/app/reports/rules.py) — nunca SQL/columnas
 * sueltas desde aquí. */
export function ReportsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('report.manage');

  const [subject, setSubject] = useState<ReportSubject | ''>('');
  const [dimensions, setDimensions] = useState<Set<string>>(new Set());
  const [metrics, setMetrics] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<ReportFilters>({});
  const [result, setResult] = useState<ReportRunResult | null>(null);
  const [resultTitle, setResultTitle] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const subjects = useQuery(reportSubjectsQuery);
  const warehouses = useQuery(warehousesQuery);
  const categories = useQuery(productCategoriesQuery);
  const products = useQuery(productsQuery({ activeOnly: true }));
  const suppliers = useQuery(suppliersQuery(true));
  const definitions = useQuery(reportDefinitionsQuery);
  const queryClient = useQueryClient();

  const subjectInfo = subjects.data?.find((s) => s.subject === subject);

  function selectSubject(value: string) {
    setSubject(value as ReportSubject | '');
    setDimensions(new Set());
    setMetrics(new Set());
    setFilters({});
    setResult(null);
    setResultTitle(null);
    setRunError(null);
  }

  const runMutation = useMutation({
    mutationFn: (payload: ReportRunRequest) => runReport(payload),
    onSuccess: (data) => {
      setResult(data);
      setRunError(null);
    },
    onError: () => setRunError('No se ha podido ejecutar el informe.'),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      createReportDefinition({
        name,
        subject: subject as ReportSubject,
        dimensions: [...dimensions],
        metrics: [...metrics],
        filters,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reportDefinitionsQuery.queryKey });
      setName('');
      setSaveError(null);
    },
    onError: () => setSaveError('No se ha podido guardar el informe.'),
  });

  const runDefinitionMutation = useMutation({
    mutationFn: (id: number) => runReportDefinition(id),
    onSuccess: (data) => {
      setResult(data);
      setResultTitle('Informe guardado');
      setRunError(null);
    },
    onError: () => setRunError('No se ha podido ejecutar el informe guardado.'),
  });

  function currentRequest(): ReportRunRequest {
    return {
      subject: subject as ReportSubject,
      dimensions: [...dimensions],
      metrics: [...metrics],
      filters,
    };
  }

  function runQuickReport(report: QuickReport) {
    setSubject(report.subject);
    setDimensions(new Set(report.dimensions));
    setMetrics(new Set(report.metrics));
    setFilters(report.filters);
    setResultTitle(report.title);
    setRunError(null);
    runMutation.mutate({
      subject: report.subject,
      dimensions: report.dimensions,
      metrics: report.metrics,
      filters: report.filters,
    });
  }

  const deleteDefinitionMutation = useMutation({
    mutationFn: (id: number) => deleteReportDefinition(id),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: reportDefinitionsQuery.queryKey }),
  });

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Informes</h1>
        <p className="mt-1 text-sm text-slate-600">
          Consulta lo importante de la tienda sin tener que construir el informe desde cero.
        </p>
      </div>

      <section className="mb-6 rounded-lg border border-brand-100 bg-brand-50/40 p-4">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-slate-900">Informes rápidos</h2>
          <p className="text-sm text-slate-600">
            Usan la jornada comercial actual en horario de la tienda. Puedes ajustar sus filtros
            abajo.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {quickReports().map((report) => (
            <button
              key={report.id}
              type="button"
              onClick={() => runQuickReport(report)}
              disabled={runMutation.isPending}
              className="rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-brand-400 hover:bg-brand-50 disabled:cursor-wait disabled:opacity-60"
            >
              <span className="block font-semibold text-brand-800">{report.title}</span>
              <span className="mt-1 block text-sm leading-5 text-slate-600">
                {report.description}
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Informe a medida</h2>
          <p className="text-sm text-slate-600">
            Elige qué analizar, cómo agruparlo y el período que quieres consultar.
          </p>
        </div>
        <label className="block text-sm text-slate-600">
          Qué quieres consultar
          <select
            value={subject}
            onChange={(event) => selectSubject(event.target.value)}
            className="mt-1 block w-64 rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Elige qué informar…</option>
            {subjects.data?.map((s) => (
              <option key={s.subject} value={s.subject}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {subjectInfo && (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-slate-500">
                  Agrupar por (opcional)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {subjectInfo.dimensions.map((dim) => (
                    <button
                      key={dim.key}
                      type="button"
                      aria-pressed={dimensions.has(dim.key)}
                      onClick={() => setDimensions((current) => toggleInSet(current, dim.key))}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                        dimensions.has(dim.key)
                          ? 'border-brand-700 bg-brand-700 text-white'
                          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {dim.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-slate-500">
                  Medir (al menos una)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {subjectInfo.metrics.map((metric) => (
                    <button
                      key={metric.key}
                      type="button"
                      aria-pressed={metrics.has(metric.key)}
                      onClick={() => setMetrics((current) => toggleInSet(current, metric.key))}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                        metrics.has(metric.key)
                          ? 'border-brand-700 bg-brand-700 text-white'
                          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {metric.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-sm text-slate-600">
                Desde
                <input
                  type="date"
                  value={filters.date_from ?? ''}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, date_from: event.target.value || null }))
                  }
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm text-slate-600">
                Hasta
                <input
                  type="date"
                  value={filters.date_to ?? ''}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, date_to: event.target.value || null }))
                  }
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                />
              </label>

              {subjectInfo.filter_keys.includes('warehouse_id') && (
                <label className="text-sm text-slate-600">
                  Almacén
                  <select
                    value={filters.warehouse_id ?? ''}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        warehouse_id: event.target.value ? Number(event.target.value) : null,
                      }))
                    }
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    <option value="">Todos</option>
                    {(warehouses.data ?? []).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {subjectInfo.filter_keys.includes('category_id') && (
                <label className="text-sm text-slate-600">
                  Categoría
                  <select
                    value={filters.category_id ?? ''}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        category_id: event.target.value ? Number(event.target.value) : null,
                      }))
                    }
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    <option value="">Todas</option>
                    {(categories.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {subjectInfo.filter_keys.includes('product_id') && (
                <label className="text-sm text-slate-600">
                  Producto
                  <select
                    value={filters.product_id ?? ''}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        product_id: event.target.value ? Number(event.target.value) : null,
                      }))
                    }
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    <option value="">Todos</option>
                    {(products.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {subjectInfo.filter_keys.includes('supplier_id') && (
                <label className="text-sm text-slate-600">
                  Proveedor
                  <select
                    value={filters.supplier_id ?? ''}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        supplier_id: event.target.value ? Number(event.target.value) : null,
                      }))
                    }
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    <option value="">Todos</option>
                    {(suppliers.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {subjectInfo.filter_keys.includes('movement_type') && (
                <label className="text-sm text-slate-600">
                  Tipo de movimiento
                  <select
                    value={filters.movement_type ?? ''}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        movement_type: event.target.value || null,
                      }))
                    }
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    <option value="">Todos</option>
                    {Object.entries(MOVEMENT_TYPES).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setResultTitle('Informe a medida');
                  runMutation.mutate(currentRequest());
                }}
                disabled={runMutation.isPending || metrics.size === 0}
                className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {runMutation.isPending ? 'Ejecutando…' : 'Ejecutar informe'}
              </button>

              {canManage && (
                <>
                  <label className="text-sm text-slate-600">
                    Guardar como
                    <input
                      type="text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Nombre del informe"
                      className="mt-1 block w-48 rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending || metrics.size === 0 || !name.trim()}
                    className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                  >
                    {saveMutation.isPending ? 'Guardando…' : 'Guardar informe'}
                  </button>
                </>
              )}
            </div>

            {runError && <p className="mt-2 text-sm text-red-600">{runError}</p>}
            {saveError && <p className="mt-2 text-sm text-red-600">{saveError}</p>}
          </>
        )}
      </div>

      {result && (
        <div className="mb-6">
          <h2 className="mb-1 text-lg font-semibold text-slate-800">
            {resultTitle ?? 'Resultado'}
          </h2>
          <p className="mb-2 text-sm text-slate-600">
            {result.rows.length === 1 ? '1 resultado' : `${result.rows.length} resultados`}
          </p>
          <ReportResultTable result={result} />
        </div>
      )}

      <h2 className="mb-2 text-lg font-semibold text-slate-800">Informes guardados</h2>
      {definitions.data && definitions.data.length === 0 && (
        <p className="text-sm text-slate-500">Todavía no has guardado ningún informe.</p>
      )}
      {definitions.data && definitions.data.length > 0 && (
        <ul className="space-y-1">
          {definitions.data.map((definition) => (
            <li
              key={definition.id}
              className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <span>
                <span className="font-medium text-slate-800">{definition.name}</span>{' '}
                <span className="text-slate-400">
                  (
                  {subjects.data?.find((s) => s.subject === definition.subject)?.label ??
                    definition.subject}
                  )
                </span>
              </span>
              <span className="flex gap-3">
                <button
                  type="button"
                  onClick={() => runDefinitionMutation.mutate(definition.id)}
                  disabled={runDefinitionMutation.isPending}
                  className="text-sm font-medium text-brand-700 hover:underline disabled:opacity-50"
                >
                  Ejecutar
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => deleteDefinitionMutation.mutate(definition.id)}
                    disabled={deleteDefinitionMutation.isPending}
                    className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
                  >
                    Eliminar
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
