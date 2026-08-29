import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

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

/** Categorías POS (fase 10): las pestañas/botones que agrupan productos en
 * la rejilla del TPV — con color y orden, independientes de las categorías
 * de estantería (`ProductCategoriesPanel`). Necesita `pos_category.manage`,
 * distinto de `product.manage`.
 *
 * Todo lo que se elige al crearla se puede cambiar después —nombre, color y
 * orden—, además de ocultarla, volver a mostrarla o borrarla. Antes sólo se
 * podía renombrar: un color mal elegido obligaba a crear otra categoría y
 * reasignarle los productos a mano. */
export function PosCategoriesPanel({ canManage }: { canManage: boolean }) {
  const categories = useQuery(posCategoriesQuery);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#64748b');
  const [order, setOrder] = useState('1');
  const [error, setError] = useState<string | null>(null);
  //: Cuál se está editando, con lo tecleado hasta ahora — se guarda al
  //: pulsar "Guardar", no al salir de cada campo, para poder cambiar el
  //: nombre y el color de una vez.
  const [draft, setDraft] = useState<PosCategory | null>(null);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: posCategoriesQuery.queryKey });

  const createMutation = useMutation({
    mutationFn: () =>
      createPosCategory({ name: name.trim(), color, display_order: Number(order) || 0 }),
    onSuccess: () => {
      invalidate();
      setName('');
      setColor('#64748b');
      setOrder('1');
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
    mutationFn: (edited: PosCategory) =>
      updatePosCategory(edited.id, {
        name: edited.name.trim(),
        color: edited.color,
        display_order: edited.display_order,
        is_default: Boolean(edited.is_default),
      }),
    onSuccess: () => {
      invalidate();
      setDraft(null);
      setError(null);
    },
    onError: (err: unknown) =>
      setError(
        err instanceof ApiError && err.code === 'conflict'
          ? 'Ya existe una categoría POS con ese nombre.'
          : 'No se ha podido guardar la categoría.',
      ),
  });

  const activeMutation = useMutation({
    mutationFn: (category: PosCategory) =>
      category.is_active ? deactivatePosCategory(category.id) : activatePosCategory(category.id),
    onSuccess: () => {
      invalidate();
      setError(null);
    },
    onError: () => setError('No se ha podido cambiar la categoría.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (category: PosCategory) => deletePosCategory(category.id),
    onSuccess: () => {
      invalidate();
      setError(null);
    },
    // El 409 trae el motivo exacto (cuántos productos la usan) y ya viene
    // en castellano: se enseña tal cual.
    onError: (err: unknown) =>
      setError(
        err instanceof ApiError && err.code === 'conflict'
          ? err.message
          : 'No se ha podido borrar la categoría.',
      ),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate();
  }

  const busy = updateMutation.isPending || activeMutation.isPending || deleteMutation.isPending;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Categorías POS</h3>

      {categories.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      <ul className="mb-3 flex flex-col gap-1.5">
        {categories.data?.map((category) => (
          <li key={category.id}>
            <div className="flex items-center gap-2 text-sm">
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: category.color }}
              />
              <span className={category.is_active ? 'text-slate-700' : 'text-slate-400'}>
                {category.name}
                {!category.is_active && ' (oculta)'}
              </span>
              <span className="text-xs text-slate-400">orden {category.display_order}</span>
              {category.is_default && (
                <span className="text-xs font-medium text-amber-700">Predeterminada en TPV</span>
              )}
              {canManage && (
                <button
                  type="button"
                  aria-label={`Editar «${category.name}»`}
                  onClick={() => {
                    setDraft(draft?.id === category.id ? null : category);
                    setError(null);
                  }}
                  className="ml-auto text-xs font-medium text-brand-700 hover:underline"
                >
                  {draft?.id === category.id ? 'Cerrar' : 'Editar'}
                </button>
              )}
            </div>

            {draft?.id === category.id && (
              <div className="mt-1.5 rounded border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-start gap-4">
                  <label className="text-xs text-slate-600">
                    Nombre
                    <input
                      type="text"
                      autoFocus
                      aria-label={`Nombre de «${category.name}»`}
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="mt-5 flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.is_default)}
                      onChange={(event) => setDraft({ ...draft, is_default: event.target.checked })}
                    />
                    Abrir por defecto en el TPV
                  </label>
                  <label className="text-xs text-slate-600">
                    Color
                    <input
                      type="color"
                      aria-label={`Color de «${category.name}»`}
                      value={draft.color}
                      onChange={(event) => setDraft({ ...draft, color: event.target.value })}
                      className="mt-1 block h-8 w-12 rounded border border-slate-300"
                    />
                  </label>
                  <label className="text-xs text-slate-600">
                    Orden
                    <input
                      type="number"
                      min={0}
                      aria-label={`Orden de «${category.name}»`}
                      value={draft.display_order}
                      onChange={(event) =>
                        setDraft({ ...draft, display_order: Number(event.target.value) || 0 })
                      }
                      className="mt-1 block w-16 rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <div className="text-xs text-slate-600">
                    <span className="block">Foto</span>
                    <div className="mt-1">
                      <ImagePicker
                        ownerType="pos_category"
                        ownerId={category.id}
                        ownerName={category.name}
                        canManage
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
                  <button
                    type="button"
                    disabled={busy || draft.name.trim() === ''}
                    onClick={() => updateMutation.mutate(draft)}
                    className="rounded bg-brand-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {updateMutation.isPending ? 'Guardando…' : 'Guardar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    className="rounded px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200"
                  >
                    Cancelar
                  </button>

                  {/* Apartadas a la derecha: son las que cuesta deshacer. */}
                  <span className="ml-auto flex gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const question = category.is_active
                          ? `¿Ocultar «${category.name}»?\n\nDejará de salir en el TPV. Los productos que la tienen la conservan, y puedes volver a mostrarla cuando quieras.`
                          : `¿Volver a mostrar «${category.name}» en el TPV?`;
                        if (window.confirm(question)) activeMutation.mutate(category);
                      }}
                      className="text-xs font-medium text-slate-600 hover:underline disabled:opacity-50"
                    >
                      {category.is_active ? 'Ocultar' : 'Mostrar'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `¿Borrar «${category.name}» definitivamente?\n\nEsto no se puede deshacer. Si prefieres conservarla, usa "Ocultar".`,
                          )
                        ) {
                          deleteMutation.mutate(category);
                        }
                      }}
                      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                    >
                      Borrar
                    </button>
                  </span>
                </div>
              </div>
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
