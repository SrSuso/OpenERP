import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { createUnit, moveUnit, unitsQuery } from '@/features/catalog/api';
import { ApiError } from '@/lib/api';

/** La lista de unidades que alimenta el desplegable "unidad base" al dar de
 * alta un producto — pedido explícitamente en vez del campo de texto
 * libre que había antes. El orden se puede cambiar (subir/bajar): es el
 * mismo orden en que aparecen las opciones del desplegable. */
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

  const moveMutation = useMutation({
    mutationFn: ({ id, direction }: { id: number; direction: 'up' | 'down' }) =>
      moveUnit(id, direction),
    onSuccess: (reordered) => queryClient.setQueryData(unitsQuery.queryKey, reordered),
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
        {list.map((unit, index) => (
          <li
            key={unit.id}
            className="flex items-center justify-between rounded border border-slate-200 px-3 py-1.5 text-sm"
          >
            <span className="text-slate-700">{unit.name}</span>
            {canManage && (
              <span className="flex gap-1">
                <button
                  type="button"
                  onClick={() => moveMutation.mutate({ id: unit.id, direction: 'up' })}
                  disabled={index === 0 || moveMutation.isPending}
                  aria-label={`Subir ${unit.name}`}
                  className="rounded px-1.5 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveMutation.mutate({ id: unit.id, direction: 'down' })}
                  disabled={index === list.length - 1 || moveMutation.isPending}
                  aria-label={`Bajar ${unit.name}`}
                  className="rounded px-1.5 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ↓
                </button>
              </span>
            )}
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
