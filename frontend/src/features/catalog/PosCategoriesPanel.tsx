import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import { Alert, Button, Card, EmptyState, FormField, Input } from '@/components/ui';
import {
  activatePosCategory,
  createPosCategory,
  deactivatePosCategory,
  deletePosCategory,
  posCategoriesQuery,
  updatePosCategory,
  type PosCategory,
} from '@/features/catalog/api';
import { ImagePicker } from '@/features/images/ImagePicker';
import { ApiError } from '@/lib/api';
import { confirmDiscard, useUnsavedWarning } from '@/lib/unsaved';

interface PosDraft {
  id: number | null;
  name: string;
  color: string;
  displayOrder: string;
  original: PosCategory | null;
}

function draftFor(category: PosCategory): PosDraft {
  return {
    id: category.id,
    name: category.name,
    color: category.color,
    displayOrder: String(category.display_order),
    original: category,
  };
}

export function PosCategoriesPanel({
  canManage,
  onDirtyChange,
}: {
  canManage: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const categories = useQuery(posCategoriesQuery);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PosDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    draft !== null &&
    (draft.original === null
      ? Boolean(draft.name || draft.displayOrder !== '0' || draft.color !== '#64748b')
      : draft.name !== draft.original.name ||
        draft.color !== draft.original.color ||
        Number(draft.displayOrder) !== draft.original.display_order);
  useUnsavedWarning(dirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: posCategoriesQuery.queryKey });

  function close() {
    setDraft(null);
    setError(null);
  }

  function open(next: PosDraft) {
    if (dirty && !confirmDiscard()) return;
    setDraft(next);
    setError(null);
  }

  const saveMutation = useMutation({
    mutationFn: (value: PosDraft) =>
      value.id === null
        ? createPosCategory({
            name: value.name.trim(),
            color: value.color,
            display_order: Number(value.displayOrder) || 0,
          })
        : updatePosCategory(value.id, {
            name: value.name.trim(),
            color: value.color,
            display_order: Number(value.displayOrder) || 0,
          }),
    onSuccess: () => {
      invalidate();
      close();
    },
    onError: (err: unknown) =>
      setError(
        err instanceof ApiError && err.code === 'conflict'
          ? 'Ya existe una categoría del TPV con ese nombre.'
          : 'No se ha podido guardar la categoría del TPV.',
      ),
  });

  const activeMutation = useMutation({
    mutationFn: (category: PosCategory) =>
      category.is_active ? deactivatePosCategory(category.id) : activatePosCategory(category.id),
    onSuccess: () => {
      invalidate();
      close();
    },
    onError: () => setError('No se ha podido cambiar el estado de la categoría.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (category: PosCategory) => deletePosCategory(category.id),
    onSuccess: () => {
      invalidate();
      close();
    },
    onError: (err: unknown) =>
      setError(
        err instanceof ApiError && err.code === 'conflict'
          ? err.message
          : 'No se ha podido borrar la categoría del TPV.',
      ),
  });

  const busy = saveMutation.isPending || activeMutation.isPending || deleteMutation.isPending;
  const selected = draft?.original ?? null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft && draft.name.trim()) saveMutation.mutate(draft);
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Categorías del TPV</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Organizan los botones que ve el cajero. No cambian la categoría de inventario del
              producto.
            </p>
          </div>
          {canManage && draft?.id !== null && (
            <Button
              onClick={() =>
                open({
                  id: null,
                  name: '',
                  color: '#64748b',
                  displayOrder: '0',
                  original: null,
                })
              }
            >
              + Nueva categoría TPV
            </Button>
          )}
        </div>

        {categories.isPending && <p className="p-5 text-sm text-slate-500">Cargando…</p>}
        {categories.isError && (
          <div className="p-5">
            <Alert tone="error">No se han podido cargar las categorías del TPV.</Alert>
          </div>
        )}
        {categories.isSuccess && categories.data.length === 0 && (
          <div className="p-5">
            <EmptyState
              title="No hay categorías del TPV"
              description="Crea una para agrupar productos en la pantalla de venta."
            />
          </div>
        )}
        {categories.data && categories.data.length > 0 && (
          <div className="divide-y divide-slate-100">
            {categories.data.map((category) => (
              <div
                key={category.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
              >
                <span
                  className="h-4 w-4 shrink-0 rounded-full border border-black/10"
                  style={{ backgroundColor: category.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{category.name}</p>
                  <p className="text-sm text-slate-500">Orden {category.display_order}</p>
                </div>
                <span
                  className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${
                    category.is_active
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {category.is_active ? 'Visible' : 'Oculta'}
                </span>
                {canManage && (
                  <Button
                    variant="ghost"
                    className="min-h-8 px-3 py-1"
                    aria-label={`Editar «${category.name}»`}
                    onClick={() => open(draftFor(category))}
                  >
                    Editar
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {draft && (
        <Card className="p-5 sm:p-6">
          <form onSubmit={submit} className="space-y-5">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {selected ? `Editar ${selected.name}` : 'Nueva categoría del TPV'}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                El color y la imagen ayudan a localizarla rápidamente en una pantalla táctil.
              </p>
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            <div className="grid gap-5 md:grid-cols-3">
              <FormField label="Nombre" htmlFor="pos-category-name">
                <Input
                  id="pos-category-name"
                  autoFocus
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </FormField>
              <FormField label="Color" htmlFor="pos-category-color">
                <input
                  id="pos-category-color"
                  type="color"
                  value={draft.color}
                  onChange={(event) => setDraft({ ...draft, color: event.target.value })}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white p-1"
                />
              </FormField>
              <FormField label="Orden" htmlFor="pos-category-order">
                <Input
                  id="pos-category-order"
                  type="number"
                  min={0}
                  value={draft.displayOrder}
                  onChange={(event) => setDraft({ ...draft, displayOrder: event.target.value })}
                />
              </FormField>
            </div>

            {selected && (
              <div>
                <p className="text-sm font-semibold text-slate-700">Imagen en el TPV</p>
                <div className="mt-2">
                  <ImagePicker
                    ownerType="pos_category"
                    ownerId={selected.id}
                    ownerName={selected.name}
                    canManage
                  />
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-5">
              <Button type="submit" disabled={busy || !draft.name.trim() || !dirty}>
                {saveMutation.isPending ? 'Guardando…' : selected ? 'Guardar cambios' : 'Crear'}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (!dirty || confirmDiscard()) close();
                }}
              >
                Cancelar
              </Button>
            </div>

            {selected && (
              <details className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                  Acciones avanzadas
                </summary>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      const question = selected.is_active
                        ? `¿Ocultar «${selected.name}»? Dejará de mostrarse en el TPV.`
                        : `¿Volver a mostrar «${selected.name}» en el TPV?`;
                      if (window.confirm(question)) activeMutation.mutate(selected);
                    }}
                  >
                    {selected.is_active ? 'Ocultar categoría' : 'Mostrar categoría'}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `¿Borrar «${selected.name}» definitivamente? Si quieres conservarla, utiliza Ocultar.`,
                        )
                      ) {
                        deleteMutation.mutate(selected);
                      }
                    }}
                  >
                    Borrar definitivamente
                  </Button>
                </div>
              </details>
            )}
          </form>
        </Card>
      )}
    </div>
  );
}
