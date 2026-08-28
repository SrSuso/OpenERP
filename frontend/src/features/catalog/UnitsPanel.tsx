import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import { Alert, Button, Card, EmptyState, FormField, Input } from '@/components/ui';
import {
  createUnit,
  deleteUnit,
  productCategoriesQuery,
  unitsQuery,
  updateUnit,
  type Unit,
} from '@/features/catalog/api';
import { ApiError } from '@/lib/api';
import { useUnsavedWarning } from '@/lib/unsaved';

export function UnitsPanel({
  canManage,
  onDirtyChange,
}: {
  canManage: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const units = useQuery(unitsQuery);
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState<string | null>(null);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [editedName, setEditedName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: unitsQuery.queryKey });
  const createMutation = useMutation({
    mutationFn: createUnit,
    onSuccess: () => {
      refresh();
      setNewName(null);
      setError(null);
    },
    onError: (err: unknown) =>
      setError(
        err instanceof ApiError && err.code === 'conflict'
          ? 'Ya existe una unidad con ese nombre.'
          : 'No se ha podido crear la unidad.',
      ),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => updateUnit(id, name),
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
      void queryClient.invalidateQueries({ queryKey: productCategoriesQuery.queryKey });
      setEditing(null);
      setError(null);
    },
    onError: (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'No se ha podido borrar la unidad.'),
  });

  const standardNames = new Set(['KG', 'L', 'UDS']);
  const busy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const dirty =
    (newName !== null && newName.trim() !== '') ||
    (editing !== null && editedName.trim() !== editing.name);
  useUnsavedWarning(dirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  function create(event: FormEvent) {
    event.preventDefault();
    const value = newName?.trim().toUpperCase();
    if (value) createMutation.mutate(value);
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Unidades</h2>
            <p className="mt-1 text-sm text-slate-600">
              Son las unidades base disponibles al crear y configurar productos.
            </p>
          </div>
          {canManage && newName === null && editing === null && (
            <Button onClick={() => setNewName('')}>+ Nueva unidad</Button>
          )}
        </div>

        {units.isPending && <p className="p-5 text-sm text-slate-500">Cargando…</p>}
        {units.isError && (
          <div className="p-5">
            <Alert tone="error">No se han podido cargar las unidades.</Alert>
          </div>
        )}
        {units.isSuccess && units.data.length === 0 && (
          <div className="p-5">
            <EmptyState title="Todavía no hay unidades" />
          </div>
        )}
        {units.data && units.data.length > 0 && (
          <div className="divide-y divide-slate-100">
            {units.data.map((unit) => {
              const standard = standardNames.has(unit.name);
              return (
                <div key={unit.id} className="flex items-center gap-3 px-5 py-4">
                  {editing?.id === unit.id ? (
                    <Input
                      autoFocus
                      aria-label={`Nombre de la unidad «${unit.name}»`}
                      value={editedName}
                      className="max-w-xs"
                      onChange={(event) => setEditedName(event.target.value)}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 font-semibold text-slate-900">{unit.name}</span>
                  )}
                  {standard && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                      Estándar
                    </span>
                  )}
                  {canManage && !standard && (
                    <div className="ml-auto flex flex-wrap gap-1">
                      {editing?.id === unit.id ? (
                        <>
                          <Button
                            className="min-h-8 px-3 py-1"
                            disabled={busy || !editedName.trim()}
                            onClick={() =>
                              updateMutation.mutate({
                                id: unit.id,
                                name: editedName.trim().toUpperCase(),
                              })
                            }
                          >
                            Guardar
                          </Button>
                          <Button
                            variant="ghost"
                            className="min-h-8 px-3 py-1"
                            onClick={() => setEditing(null)}
                          >
                            Cancelar
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            className="min-h-8 px-3 py-1"
                            aria-label={`Editar unidad «${unit.name}»`}
                            onClick={() => {
                              setEditing(unit);
                              setEditedName(unit.name);
                              setError(null);
                            }}
                          >
                            Editar
                          </Button>
                          <Button
                            variant="danger"
                            className="min-h-8 px-3 py-1"
                            aria-label={`Borrar unidad «${unit.name}»`}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `¿Borrar la unidad «${unit.name}»? Las categorías dejarán de proponerla; los productos existentes conservarán su unidad histórica.`,
                                )
                              ) {
                                deleteMutation.mutate(unit.id);
                              }
                            }}
                          >
                            Borrar
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {newName !== null && (
        <Card className="p-5 sm:p-6">
          <form onSubmit={create} className="max-w-lg space-y-5">
            <h2 className="text-lg font-bold text-slate-900">Nueva unidad</h2>
            {error && <Alert tone="error">{error}</Alert>}
            <FormField
              label="Nombre corto"
              htmlFor="new-unit-name"
              hint="Por ejemplo: CAJA, BOTELLA o BANDEJA. Se guardará en mayúsculas."
            >
              <Input
                id="new-unit-name"
                autoFocus
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </FormField>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || !newName.trim()}>
                {createMutation.isPending ? 'Creando…' : 'Crear unidad'}
              </Button>
              <Button variant="ghost" onClick={() => setNewName(null)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}

      {error && newName === null && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
