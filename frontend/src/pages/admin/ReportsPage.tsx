import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/features/auth/useAuth';
import { productCategoriesQuery, productsQuery } from '@/features/catalog/api';
import { warehousesQuery } from '@/features/inventory/api';
import { columnLabel } from '@/features/reports/columnLabels';
import { ReportResultTable } from '@/features/reports/ReportResultTable';
import {
  createReportDefinition,
  deleteReportDefinition,
  reportDefinitionsQuery,
  reportSubjectsQuery,
  runReport,
  runReportDefinition,
  updateReportDefinition,
  type ReportDefinition,
  type ReportFilters,
  type ReportRunRequest,
  type ReportRunResult,
  type ReportSubject,
} from '@/features/reports/api';
import { suppliersQuery } from '@/features/suppliers/api';
import { usersQuery } from '@/features/users/api';

const MOVEMENT_TYPES: Record<string, string> = {
  PURCHASE_RECEIPT: 'Recepción de compra',
  SALE: 'Venta',
  ADJUSTMENT: 'Ajuste',
  WASTE: 'Merma',
  TRANSFER_OUT: 'Transferencia (salida)',
  TRANSFER_IN: 'Transferencia (entrada)',
  RETURN: 'Devolución',
};

function toggleInSet(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(result: ReportRunResult, title: string | null): void {
  const rows = [
    result.columns.map(columnLabel),
    ...result.rows.map((row) => result.columns.map((column) => row[column])),
  ];
  const csv = `\ufeff${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(title ?? 'informe').toLowerCase().replaceAll(/[^a-z0-9áéíóúüñ]+/gi, '-')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function filtersFromDefinition(filters: Record<string, unknown>): ReportFilters {
  const value = (key: keyof ReportFilters) => filters[key];
  const dateFrom = value('date_from');
  const dateTo = value('date_to');
  const movementType = value('movement_type');
  const numberValue = (
    key: 'warehouse_id' | 'category_id' | 'product_id' | 'supplier_id' | 'cashier_user_id',
  ) => {
    const candidate = value(key);
    return typeof candidate === 'number' ? candidate : null;
  };
  return {
    date_from: typeof dateFrom === 'string' ? dateFrom : null,
    date_to: typeof dateTo === 'string' ? dateTo : null,
    warehouse_id: numberValue('warehouse_id'),
    category_id: numberValue('category_id'),
    product_id: numberValue('product_id'),
    supplier_id: numberValue('supplier_id'),
    cashier_user_id: numberValue('cashier_user_id'),
    movement_type: typeof movementType === 'string' ? movementType : null,
  };
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
  const [editingDefinitionId, setEditingDefinitionId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const subjects = useQuery(reportSubjectsQuery);
  const warehouses = useQuery(warehousesQuery);
  const categories = useQuery(productCategoriesQuery);
  const products = useQuery(productsQuery({ activeOnly: true }));
  const suppliers = useQuery(suppliersQuery(true));
  const users = useQuery(usersQuery);
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
    setEditingDefinitionId(null);
    setName('');
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
    mutationFn: (payload: ReportRunRequest & { name: string; definitionId: number | null }) => {
      const { definitionId, ...definition } = payload;
      return definitionId === null
        ? createReportDefinition(definition)
        : updateReportDefinition(definitionId, definition);
    },
    onSuccess: (definition) => {
      void queryClient.invalidateQueries({ queryKey: reportDefinitionsQuery.queryKey });
      setEditingDefinitionId(definition.id);
      setName(definition.name);
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

  function editDefinition(definition: ReportDefinition) {
    setSubject(definition.subject);
    setDimensions(new Set(definition.dimensions));
    setMetrics(new Set(definition.metrics));
    setFilters(filtersFromDefinition(definition.filters));
    setName(definition.name);
    setEditingDefinitionId(definition.id);
    setResult(null);
    setResultTitle(null);
    setRunError(null);
    setSaveError(null);
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

      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Informe a medida</h2>
          <p className="text-sm text-slate-600">
            Elige qué analizar, cómo agruparlo y el período que quieres consultar.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
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
          {subject && (
            <button
              type="button"
              onClick={() => selectSubject('')}
              className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Limpiar informe
            </button>
          )}
        </div>

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

              {subjectInfo.filter_keys.includes('cashier_user_id') && (
                <label className="text-sm text-slate-600">
                  Cajero
                  <select
                    value={filters.cashier_user_id ?? ''}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        cashier_user_id: event.target.value ? Number(event.target.value) : null,
                      }))
                    }
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    <option value="">Todos</option>
                    {(users.data ?? []).map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name}
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
                    onClick={() =>
                      saveMutation.mutate({
                        ...currentRequest(),
                        name,
                        definitionId: editingDefinitionId,
                      })
                    }
                    disabled={saveMutation.isPending || metrics.size === 0 || !name.trim()}
                    className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                  >
                    {saveMutation.isPending
                      ? 'Guardando…'
                      : editingDefinitionId === null
                        ? 'Guardar informe'
                        : 'Guardar cambios'}
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
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">{resultTitle ?? 'Resultado'}</h2>
              <p className="text-sm text-slate-600">
                {result.rows.length === 1 ? '1 resultado' : `${result.rows.length} resultados`}
              </p>
            </div>
            {result.rows.length > 0 && (
              <button
                type="button"
                onClick={() => downloadCsv(result, resultTitle)}
                className="rounded border border-brand-700 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
              >
                Descargar CSV
              </button>
            )}
          </div>
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
                {canManage && (
                  <button
                    type="button"
                    onClick={() => editDefinition(definition)}
                    className="text-sm font-medium text-slate-700 hover:underline"
                  >
                    Editar
                  </button>
                )}
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
