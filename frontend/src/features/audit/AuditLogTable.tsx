import { Fragment, useState } from 'react';

import { type AuditLogEntry } from '@/features/audit/api';
import { useBusinessTimezone } from '@/features/settings/useShopSettings';
import { formatBusinessDateTime } from '@/lib/businessTime';

/** Nombre a mostrar para el autor de una entrada — `null` es una acción del
 * sistema (el worker de outbox, un job en segundo plano), no un usuario. */
function userLabel(userId: number | null, userNames: Record<number, string>): string {
  if (userId === null) return 'Sistema';
  return userNames[userId] ?? `Usuario #${userId}`;
}

/** Las referencias técnicas del catálogo sirven para relacionar datos, pero
 * no son útiles al revisar una auditoría. Se eliminan también de entradas
 * históricas, que se guardaron antes de que dejaran de mostrarse. */
function withoutInternalProductReferences(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutInternalProductReferences);
  if (typeof value !== 'object' || value === null) return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nestedValue]) =>
      key === 'sku' || key === 'product_sku' || key === 'catalog.sku_prefix'
        ? []
        : [[key, withoutInternalProductReferences(nestedValue)]],
    ),
  );
}

export function AuditLogTable({
  entries,
  userNames,
}: {
  entries: AuditLogEntry[];
  userNames: Record<number, string>;
}) {
  const businessTimezone = useBusinessTimezone();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">No hay entradas con estos filtros.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Fecha</th>
            <th className="px-4 py-2 font-medium">Usuario</th>
            <th className="px-4 py-2 font-medium">Acción</th>
            <th className="px-4 py-2 font-medium">Entidad</th>
            <th className="px-4 py-2 font-medium">IP</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <Fragment key={entry.id}>
              <tr className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 text-xs text-slate-500">
                  {formatBusinessDateTime(entry.created_at, businessTimezone)}
                </td>
                <td className="px-4 py-2">{userLabel(entry.user_id, userNames)}</td>
                <td className="px-4 py-2 font-mono text-xs">{entry.action}</td>
                <td className="px-4 py-2">
                  {entry.entity_type}
                  {entry.entity_id !== null && (
                    <span className="text-slate-400"> #{entry.entity_id}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-slate-400">{entry.ip ?? '—'}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId((current) => (current === entry.id ? null : entry.id))
                    }
                    className="text-sm font-medium text-slate-600 hover:underline"
                  >
                    {expandedId === entry.id ? 'Ocultar' : 'Ver detalle'}
                  </button>
                </td>
              </tr>
              {expandedId === entry.id && (
                <tr>
                  <td colSpan={6} className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Antes</p>
                        <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-slate-700">
                          {entry.before_data
                            ? JSON.stringify(
                                withoutInternalProductReferences(entry.before_data),
                                null,
                                2,
                              )
                            : '—'}
                        </pre>
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase text-slate-500">
                          Después
                        </p>
                        <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-slate-700">
                          {entry.after_data
                            ? JSON.stringify(
                                withoutInternalProductReferences(entry.after_data),
                                null,
                                2,
                              )
                            : '—'}
                        </pre>
                      </div>
                    </div>
                    {entry.request_id && (
                      <p className="mt-2 text-xs text-slate-400">Petición: {entry.request_id}</p>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
