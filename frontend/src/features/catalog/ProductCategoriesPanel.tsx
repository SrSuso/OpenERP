import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import {
  activateProductCategory,
  createProductCategory,
  deactivateProductCategory,
  deleteProductCategory,
  renameProductCategory,
  productCategoriesQuery,
  type ProductCategory,
} from '@/features/catalog/api';
import { ImagePicker } from '@/features/images/ImagePicker';
import { setCategoryPricing, taxesQuery, type Tax } from '@/features/pricing/api';
import { TaxChips } from '@/features/pricing/TaxChips';
import { ApiError } from '@/lib/api';

/** Categorías de estantería (independientes de las categorías POS del TPV
 * — ver `PosCategoriesPanel`). Alta simple, más el margen/impuestos por
 * defecto que heredan sus productos (ver `CategoryPricingRow`).
 *
 * Se pueden ocultar (reversible, y los productos que ya la tienen la
 * conservan) o borrar del todo, que sólo se permite si no la usa ningún
 * producto. Las dos piden confirmación: son acciones que cuesta deshacer
 * a mano si se pulsan sin querer. */
export function ProductCategoriesPanel({ canManage }: { canManage: boolean }) {
  const categories = useQuery(productCategoriesQuery);
  const taxes = useQuery(taxesQuery);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // Cuál se está renombrando (ninguna = null) y el nombre a medio escribir.
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameInput, setRenameInput] = useState('');

  const createMutation = useMutation({
    mutationFn: (value: string) => createProductCategory(value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productCategoriesQuery.queryKey });
      setName('');
      setError(null);
    },
    onError: (err: unknown) => {
      setError(
        err instanceof ApiError && err.code === 'conflict'
          ? 'Ya existe una categoría con ese nombre.'
          : 'No se ha podido crear la categoría.',
      );
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name: value }: { id: number; name: string }) =>
      renameProductCategory(id, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productCategoriesQuery.queryKey });
      // El nombre de la categoría se ve en la lista de productos.
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });
      setRenamingId(null);
      setError(null);
    },
    onError: (err: unknown) => {
      setError(
        err instanceof ApiError && err.code === 'conflict'
          ? 'Ya existe una categoría con ese nombre.'
          : 'No se ha podido cambiar el nombre.',
      );
    },
  });

  const activeMutation = useMutation({
    mutationFn: (category: ProductCategory) =>
      category.is_active
        ? deactivateProductCategory(category.id)
        : activateProductCategory(category.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productCategoriesQuery.queryKey });
      setError(null);
    },
    onError: () => setError('No se ha podido cambiar la categoría.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (category: ProductCategory) => deleteProductCategory(category.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productCategoriesQuery.queryKey });
      setError(null);
    },
    onError: (err: unknown) =>
      // El 409 trae el motivo exacto (cuántos productos la usan) y ya viene
      // en castellano: se enseña tal cual en vez de un genérico.
      setError(
        err instanceof ApiError && err.code === 'conflict'
          ? err.message
          : 'No se ha podido borrar la categoría.',
      ),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate(name.trim());
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Categorías de producto</h3>

      {categories.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      <ul className="mb-3 flex flex-col gap-1.5">
        {categories.data?.map((category) => (
          <li key={category.id}>
            <div className="flex items-center gap-2 text-sm">
              <ImagePicker
                ownerType="product_category"
                ownerId={category.id}
                ownerName={category.name}
                canManage={canManage}
              />
              {renamingId === category.id ? (
                <>
                  <input
                    type="text"
                    autoFocus
                    aria-label={`Nombre de «${category.name}»`}
                    value={renameInput}
                    onChange={(event) => setRenameInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setRenamingId(null);
                    }}
                    className="w-48 rounded border border-slate-300 px-3 py-1 text-sm"
                  />
                  <button
                    type="button"
                    disabled={renameMutation.isPending || renameInput.trim() === ''}
                    onClick={() =>
                      renameMutation.mutate({ id: category.id, name: renameInput.trim() })
                    }
                    className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
                  >
                    Guardar nombre
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenamingId(null)}
                    className="text-xs font-medium text-slate-600 hover:underline"
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <span
                  className={`rounded-full px-3 py-1 ${
                    category.is_active
                      ? 'bg-slate-100 text-slate-700'
                      : 'bg-slate-50 text-slate-400'
                  }`}
                >
                  {category.name}
                  {!category.is_active && <span className="ml-1 text-xs">(oculta)</span>}
                </span>
              )}
              {canManage && renamingId !== category.id && (
                <>
                  <button
                    type="button"
                    // Con el nombre dentro: la pantalla tiene varias filas, y
                    // el panel de categorías POS de al lado tiene su propio
                    // "Renombrar".
                    aria-label={`Renombrar «${category.name}»`}
                    onClick={() => {
                      setRenamingId(category.id);
                      setRenameInput(category.name);
                      setError(null);
                    }}
                    className="text-xs font-medium text-brand-700 hover:underline"
                  >
                    Renombrar
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId((current) => (current === category.id ? null : category.id))
                    }
                    className="text-xs font-medium text-brand-700 hover:underline"
                  >
                    {expandedId === category.id ? 'Cerrar precio' : 'Margen/impuestos'}
                  </button>
                  <button
                    type="button"
                    disabled={activeMutation.isPending}
                    onClick={() => {
                      const question = category.is_active
                        ? `¿Ocultar «${category.name}»?\n\nDejará de poder elegirse al clasificar productos. Los que ya la tienen la conservan, y puedes volver a mostrarla cuando quieras.`
                        : `¿Volver a mostrar «${category.name}»?`;
                      if (window.confirm(question)) activeMutation.mutate(category);
                    }}
                    className="text-xs font-medium text-slate-600 hover:underline disabled:opacity-50"
                  >
                    {category.is_active ? 'Ocultar' : 'Mostrar'}
                  </button>
                  <button
                    type="button"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `¿Borrar «${category.name}» definitivamente?\n\nEsto no se puede deshacer. Si prefieres conservarla por si acaso, usa "Ocultar".`,
                        )
                      ) {
                        deleteMutation.mutate(category);
                      }
                    }}
                    className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                  >
                    Borrar
                  </button>
                </>
              )}
            </div>
            {expandedId === category.id && (
              <CategoryPricingRow category={category} taxes={taxes.data ?? []} />
            )}
          </li>
        ))}
        {categories.data?.length === 0 && (
          <p className="text-sm text-slate-500">Todavía no hay ninguna.</p>
        )}
      </ul>

      {canManage && (
        <form onSubmit={submit} className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nombre de la categoría"
            className="w-48 rounded border border-slate-300 px-3 py-1.5 text-sm"
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

/** El margen/impuestos por defecto de una categoría — todo producto suyo
 * sin su propio valor hereda esto (ver features/pricing/ProductPricingPanel,
 * donde un producto lo pisa explícitamente). */
function CategoryPricingRow({ category, taxes }: { category: ProductCategory; taxes: Tax[] }) {
  const queryClient = useQueryClient();
  const [marginInput, setMarginInput] = useState(category.margin_rate ?? '');
  const [taxIds, setTaxIds] = useState<Set<number>>(new Set(category.taxes.map((t) => t.id)));

  const saveMutation = useMutation({
    mutationFn: () =>
      setCategoryPricing(category.id, {
        margin_rate: marginInput.trim() === '' ? null : marginInput,
        tax_ids: [...taxIds],
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productCategoriesQuery.queryKey });
      // Guardar recalcula el PVP de todos los productos de la categoría
      // (backend: app.pricing.service.update_category_pricing) — refresca
      // la lista de productos para que se vea al momento.
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });
    },
  });

  return (
    <div className="mt-1.5 rounded border border-slate-200 bg-slate-50 p-3">
      <label className="mb-2 block text-xs text-slate-600">
        Margen por defecto (%)
        <input
          type="text"
          inputMode="decimal"
          value={marginInput}
          onChange={(event) => setMarginInput(event.target.value)}
          placeholder="vacío = sin margen por defecto"
          className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </label>

      <p className="mb-1 text-xs text-slate-600">Impuestos por defecto</p>
      <div className="mb-2">
        <TaxChips taxes={taxes} selected={taxIds} onChange={setTaxIds} />
      </div>

      <button
        type="button"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        className="rounded bg-brand-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  );
}
