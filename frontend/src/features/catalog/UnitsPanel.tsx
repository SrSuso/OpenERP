import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { createUnit, deleteUnit, unitsQuery, updateUnit, type Unit } from '@/features/catalog/api';
import { ApiError } from '@/lib/api';

/** Catálogo de unidades que alimenta los desplegables de categorías y
 * productos. La unidad por defecto se elige explícitamente en cada
 * categoría; esta lista no expresa ninguna prioridad. */
export function UnitsPanel({ canManage }: { canManage: boolean }) {
  const units = useQuery(unitsQuery);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Unit | null>(null);
  const [editedName, setEditedName] = useState('');
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

  const refresh = () => void queryClient.invalidateQueries({ queryKey: unitsQuery.queryKey });

  const updateMutation = useMutation({
    mutationFn: ({ id, value }: { id: number; value: string }) => updateUnit(id, value),
    onSuccess: () => {
      refresh();
      setEditing(null);
      setEditedName('');
      setError(null);
    },
    onError: (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'No se ha podido modificar la unidad.'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUnit,
    onSuccess: () => {
      refresh();
      setError(null);
    },
    onError: (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'No se ha podido borrar la unidad.'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate(name.trim().toUpperCase());
  }

  const list = units.data ?? [];
  const isStandard = (unit: Unit) => ['KG', 'L', 'UDS'].includes(unit.name);
  const busy = updateMutation.isPending || deleteMutation.isPending;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Unidades</h3>

      {units.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      <ul className="mb-3 flex flex-col gap-1">
        {list.map((unit) => (
          <li
            key={unit.id}
            className="flex items-center gap-2 rounded border border-slate-200 px-3 py-1.5 text-sm"
          >
            {editing?.id === unit.id ? (
              <input
                type="text"
                aria-label={`Nombre de la unidad «${unit.name}»`}
                value={editedName}
                onChange={(event) => setEditedName(event.target.value)}
                className="w-32 rounded border border-slate-300 px-2 py-1 text-sm"
              />
            ) : (
              <span className="text-slate-700">{unit.name}</span>
            )}
            {isStandard(unit) && <span className="text-xs text-slate-400">Estándar</span>}
            {canManage && !isStandard(unit) && (
              <span className="ml-auto flex items-center gap-2">
                {editing?.id === unit.id ? (
                  <>
                    <button
                      type="button"
                      disabled={busy || editedName.trim() === ''}
                      onClick={() =>
                        updateMutation.mutate({
                          id: unit.id,
                          value: editedName.trim().toUpperCase(),
                        })
                      }
                      className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditing(null);
                        setEditedName('');
                      }}
                      className="text-xs font-medium text-slate-600 hover:underline disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Editar unidad «${unit.name}»`}
                      onClick={() => {
                        setEditing(unit);
                        setEditedName(unit.name);
                        setError(null);
                      }}
                      className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Borrar unidad «${unit.name}»`}
                      onClick={() => {
                        if (window.confirm(`¿Borrar la unidad «${unit.name}»?`)) {
                          deleteMutation.mutate(unit.id);
                        }
                      }}
                      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                    >
                      Borrar
                    </button>
                  </>
                )}
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
