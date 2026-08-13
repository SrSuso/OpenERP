import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { auditLogQuery } from '@/features/audit/api';
import { AuditLogTable } from '@/features/audit/AuditLogTable';
import { usersQuery } from '@/features/users/api';

const PAGE_SIZE = 50;

/** `/admin/audit-log` — gated por `audit.read` (sólo ADMIN, ver
 * backend/app/rbac/permissions.py's PHASE_2_ROLE_GRANTS). Sólo lectura: el
 * registro es de sólo-anexado, no hay nada que editar/borrar desde aquí
 * (ver backend/app/audit/service.py). */
export function AuditLogPage() {
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [userId, setUserId] = useState('');
  const [page, setPage] = useState(0);

  const users = useQuery(usersQuery);
  const userNames = Object.fromEntries((users.data ?? []).map((u) => [u.id, u.full_name] as const));

  const entries = useQuery(
    auditLogQuery({
      // `exactOptionalPropertyTypes` no admite asignar `undefined`
      // explícitamente a una propiedad opcional — se omite la clave en
      // vez de ponerla a `undefined` cuando el filtro está vacío.
      ...(entityType.trim() ? { entityType: entityType.trim() } : {}),
      ...(entityId.trim() ? { entityId: Number(entityId) } : {}),
      ...(userId ? { userId: Number(userId) } : {}),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
  );

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(0);
  }

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">Auditoría</h1>
      <p className="mb-4 text-sm text-slate-500">
        Historial de sólo lectura de quién ha cambiado qué, en toda la aplicación — no se puede
        editar ni borrar desde aquí.
      </p>

      <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <label className="text-sm text-slate-600">
          Tipo de entidad
          <input
            type="text"
            placeholder="p.ej. product, sale, settings"
            value={entityType}
            onChange={(event) => updateFilter(setEntityType, event.target.value)}
            className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm text-slate-600">
          Id de la entidad
          <input
            type="text"
            inputMode="numeric"
            value={entityId}
            onChange={(event) => updateFilter(setEntityId, event.target.value.replace(/\D/g, ''))}
            className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm text-slate-600">
          Usuario
          <select
            value={userId}
            onChange={(event) => updateFilter(setUserId, event.target.value)}
            className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            {(users.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {entries.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {entries.data && <AuditLogTable entries={entries.data} userNames={userNames} />}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => setPage((current) => Math.max(0, current - 1))}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        >
          ← Anterior
        </button>
        <span className="text-xs text-slate-500">Página {page + 1}</span>
        <button
          type="button"
          disabled={!entries.data || entries.data.length < PAGE_SIZE}
          onClick={() => setPage((current) => current + 1)}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        >
          Siguiente →
        </button>
      </div>
    </section>
  );
}
