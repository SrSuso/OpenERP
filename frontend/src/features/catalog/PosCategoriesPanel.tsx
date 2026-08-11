import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import {
  createPosCategory,
  deactivatePosCategory,
  posCategoriesQuery,
  updatePosCategory,
  type PosCategory,
} from '@/features/catalog/api';
import { ImagePicker } from '@/features/images/ImagePicker';
import { ApiError } from '@/lib/api';

/** Categorías POS (fase 10): las pestañas/botones que agrupan productos en
 * la rejilla del TPV — con color y orden, independientes de las categorías
 * de estantería (`ProductCategoriesPanel`). Necesita `pos_category.manage`,
 * distinto de `product.manage`. */
export function PosCategoriesPanel({ canManage }: { canManage: boolean }) {
  const categories = useQuery(posCategoriesQuery);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#64748b');
  const [order, setOrder] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: posCategoriesQuery.queryKey });

  const createMutation = useMutation({
    mutationFn: () =>
      createPosCategory({ name: name.trim(), color, display_order: Number(order) || 0 }),
    onSuccess: () => {
      invalidate();
      setName('');
      setColor('#64748b');
      setOrder('0');
      setError(null);
    },
    onError: (err: unknown) => {
      setError(
        err instanceof ApiError && err.code === 'conflict'
          ? 'Ya existe una categoría POS con ese nombre.'
          : 'No se ha podido crear la categoría.',
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<PosCategory> }) =>
      updatePosCategory(id, patch),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => deactivatePosCategory(id),
    onSuccess: invalidate,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate();
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Categorías POS</h3>

      {categories.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      <ul className="mb-3 flex flex-col gap-1.5">
        {categories.data?.map((category) => (
          <li key={category.id} className="flex items-center gap-2 text-sm">
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: category.color }}
            />
            <ImagePicker
              ownerType="pos_category"
              ownerId={category.id}
              ownerName={category.name}
              canManage={canManage}
            />
            {editingId === category.id ? (
              <>
                <input
                  type="text"
                  defaultValue={category.name}
                  onBlur={(event) =>
                    updateMutation.mutate({ id: category.id, patch: { name: event.target.value } })
                  }
                  className="w-32 rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="text-xs text-slate-500 hover:underline"
                >
                  Listo
                </button>
              </>
            ) : (
              <span className={category.is_active ? 'text-slate-700' : 'text-slate-400'}>
                {category.name}
                {!category.is_active && ' (inactiva)'}
              </span>
            )}
            {canManage && editingId !== category.id && (
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingId(category.id)}
                  className="text-xs font-medium text-brand-700 hover:underline"
                >
                  Renombrar
                </button>
                {category.is_active && (
                  <button
                    type="button"
                    onClick={() => deactivateMutation.mutate(category.id)}
                    disabled={deactivateMutation.isPending}
                    className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                  >
                    Desactivar
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
        {categories.data?.length === 0 && (
          <p className="text-sm text-slate-500">Todavía no hay ninguna.</p>
        )}
      </ul>

      {canManage && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">
            Nombre
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 block w-32 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Color
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="mt-1 block h-8 w-12 rounded border border-slate-300"
            />
          </label>
          <label className="text-xs text-slate-600">
            Orden
            <input
              type="number"
              min={0}
              value={order}
              onChange={(event) => setOrder(event.target.value)}
              className="mt-1 block w-16 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
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
