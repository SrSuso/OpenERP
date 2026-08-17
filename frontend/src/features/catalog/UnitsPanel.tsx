import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { createUnit, unitsQuery } from '@/features/catalog/api';
import { ApiError } from '@/lib/api';

/** Catálogo de unidades que alimenta los desplegables de categorías y
 * productos. La unidad por defecto se elige explícitamente en cada
 * categoría; esta lista no expresa ninguna prioridad. */
export function UnitsPanel({ canManage }: { canManage: boolean }) {
  const units = useQuery(unitsQuery);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (value: string) => createUnit(value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: unitsQuery.queryKey });
      setName('');
      setError(null);
    },
    onError: (err: unknown) => {
      setError(
        err instanceof ApiError && err.code === 'conflict'
          ? 'Ya existe una unidad con ese nombre.'
          : 'No se ha podido crear la unidad.',
      );
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate(name.trim().toUpperCase());
  }

  const list = units.data ?? [];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Unidades</h3>

      {units.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      <ul className="mb-3 flex flex-col gap-1">
        {list.map((unit) => (
          <li
            key={unit.id}
            className="flex items-center justify-between rounded border border-slate-200 px-3 py-1.5 text-sm"
          >
            <span className="text-slate-700">{unit.name}</span>
          </li>
        ))}
        {list.length === 0 && !units.isPending && (
          <p className="text-sm text-slate-500">Todavía no hay ninguna.</p>
        )}
      </ul>

      {canManage && (
        <form onSubmit={submit} className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="UNIT, KG, L…"
            className="w-32 rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded bg-brand-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Añadir
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
