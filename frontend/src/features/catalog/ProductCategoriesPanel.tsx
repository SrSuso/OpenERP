import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';

import {
  activateProductCategory,
  createProductCategory,
  deactivateProductCategory,
  deleteProductCategory,
  productCategoriesQuery,
  updateProductCategory,
  type ProductCategory,
} from '@/features/catalog/api';
import { ImagePicker } from '@/features/images/ImagePicker';
import { setCategoryPricing, taxesQuery, type Tax } from '@/features/pricing/api';
import { TaxChips } from '@/features/pricing/TaxChips';
import { ApiError } from '@/lib/api';

/** Categorías de estantería (independientes de las categorías POS del TPV
 * — ver `PosCategoriesPanel`).
 *
 * Una fila por categoría, con un único botón «Editar» que abre todo lo que
 * se puede hacer con ella: el nombre, la foto, el margen y los impuestos
 * que heredan sus productos, y las acciones de ocultarla o borrarla. Antes
 * era un botón por acción en la propia fila, y con cuatro categorías la
 * pantalla ya era una pared de enlaces. */
export function ProductCategoriesPanel({ canManage }: { canManage: boolean }) {
  const categories = useQuery(productCategoriesQuery);
  const taxes = useQuery(taxesQuery);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  //: Cuál está abierta para editar (ninguna = null).
  const [editingId, setEditingId] = useState<number | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: productCategoriesQuery.queryKey });
    // El nombre de la categoría se ve en la lista de productos, y su
    // margen/impuestos cambian el PVP de los que la heredan.
    void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });
  };

  const createMutation = useMutation({
    mutationFn: (value: string) => createProductCategory(value),
    onSuccess: () => {
      invalidate();
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
              <span
                className={`rounded-full px-3 py-1 ${
                  category.is_active ? 'bg-slate-100 text-slate-700' : 'bg-slate-50 text-slate-400'
                }`}
              >
                {category.name}
                {!category.is_active && <span className="ml-1 text-xs">(oculta)</span>}
              </span>
              {canManage && (
                <button
                  type="button"
                  aria-label={`Editar «${category.name}»`}
                  onClick={() => {
                    setEditingId((current) => (current === category.id ? null : category.id));
                    setError(null);
                  }}
                  className="text-xs font-medium text-brand-700 hover:underline"
                >
                  {editingId === category.id ? 'Cerrar' : 'Editar'}
                </button>
              )}
            </div>

            {editingId === category.id && (
              <CategoryEditor
                category={category}
                taxes={taxes.data ?? []}
                onDone={() => setEditingId(null)}
                onError={setError}
                invalidate={invalidate}
              />
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

/** Todo lo que se puede hacer con una categoría, en un sitio: su nombre, su
 * foto, el margen y los impuestos por defecto que heredan sus productos, y
 * las acciones que cuesta deshacer, apartadas abajo y con confirmación. */
function CategoryEditor({
  category,
  taxes,
  onDone,
  onError,
  invalidate,
}: {
  category: ProductCategory;
  taxes: Tax[];
  onDone: () => void;
  onError: (message: string | null) => void;
  invalidate: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [tracksStock, setTracksStock] = useState(category.tracks_stock);
  const [marginInput, setMarginInput] = useState(category.margin_rate ?? '');
  const [amountInput, setAmountInput] = useState(category.margin_amount ?? '');
  const [formulaInput, setFormulaInput] = useState(category.price_formula ?? '');
  const [taxIds, setTaxIds] = useState<Set<number>>(new Set(category.taxes.map((t) => t.id)));
  const formulaFieldId = useId();

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (name.trim() !== category.name || tracksStock !== category.tracks_stock) {
        await updateProductCategory(category.id, {
          name: name.trim(),
          tracks_stock: tracksStock,
        });
      }
      await setCategoryPricing(category.id, {
        margin_rate: marginInput.trim() === '' ? null : marginInput,
        margin_amount: amountInput.trim() === '' ? null : amountInput,
        // Vacío = quitarla y volver a la fórmula de la tienda.
        price_formula: formulaInput.trim(),
        tax_ids: [...taxIds],
      });
    },
    onSuccess: () => {
      invalidate();
      onError(null);
      onDone();
    },
    onError: (err: unknown) =>
      onError(
        err instanceof ApiError && err.code === 'conflict'
          ? 'Ya existe una categoría con ese nombre.'
          : 'No se ha podido guardar la categoría.',
      ),
  });

  const activeMutation = useMutation({
    mutationFn: () =>
      category.is_active
        ? deactivateProductCategory(category.id)
        : activateProductCategory(category.id),
    onSuccess: () => {
      invalidate();
      onError(null);
    },
    onError: () => onError('No se ha podido cambiar la categoría.'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProductCategory(category.id),
    onSuccess: () => {
      invalidate();
      onError(null);
      onDone();
    },
    // El 409 trae el motivo exacto (cuántos productos la usan) y ya viene
    // en castellano: se enseña tal cual.
    onError: (err: unknown) =>
      onError(
        err instanceof ApiError && err.code === 'conflict'
          ? err.message
          : 'No se ha podido borrar la categoría.',
      ),
  });

  const busy = saveMutation.isPending || activeMutation.isPending || deleteMutation.isPending;

  return (
    <div className="mt-1.5 rounded border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-start gap-4">
        <label className="text-xs text-slate-600">
          Nombre
          <input
            type="text"
            autoFocus
            aria-label={`Nombre de «${category.name}»`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 block w-48 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>

        <label className="text-xs text-slate-600">
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

        <label className="text-xs text-slate-600">
          Margen fijo por defecto (€)
          <input
            type="text"
            inputMode="decimal"
            value={amountInput}
            onChange={(event) => setAmountInput(event.target.value)}
            placeholder="p. ej. 0,25"
            className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>

        <div className="text-xs text-slate-600">
          <span className="block">Foto</span>
          <div className="mt-1">
            <ImagePicker
              ownerType="product_category"
              ownerId={category.id}
              ownerName={category.name}
              canManage
            />
          </div>
        </div>
      </div>

      <label className="mt-3 flex items-start gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={tracksStock}
          onChange={(event) => setTracksStock(event.target.checked)}
        />
        <span>
          Llevar control de existencias
          <span className="mt-0.5 block text-slate-400">
            Apagado, sus productos no se agotan: se venden sin comprobar ni descontar stock. Para lo
            que se repone del saco sin contarlo. Un producto suyo puede decir lo contrario.
          </span>
        </span>
      </label>

      {/* La tercera forma de poner precio, para cuando ni un porcentaje ni
          una cantidad fija valen. Va fuera de la rejilla porque es larga. */}
      <div className="mt-3 text-xs text-slate-600">
        <label htmlFor={formulaFieldId}>Fórmula por defecto</label>
        <input
          id={formulaFieldId}
          type="text"
          value={formulaInput}
          onChange={(event) => setFormulaInput(event.target.value)}
          placeholder="vacío = la fórmula de la tienda"
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
        />
        <span className="mt-1 block text-slate-400">
          Se aplica a sus productos, salvo a los que tengan la suya propia. Variables: cost,
          tax_rate, surcharge_rate, margin_rate, margin_amount.
        </span>
      </div>

      <p className="mt-3 mb-1 text-xs text-slate-600">Impuestos por defecto</p>
      <TaxChips taxes={taxes} selected={taxIds} onChange={setTaxIds} />

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={busy || name.trim() === ''}
          className="rounded bg-brand-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={onDone}
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
                ? `¿Ocultar «${category.name}»?\n\nDejará de poder elegirse al clasificar productos. Los que ya la tienen la conservan, y puedes volver a mostrarla cuando quieras.`
                : `¿Volver a mostrar «${category.name}»?`;
              if (window.confirm(question)) activeMutation.mutate();
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
                  `¿Borrar «${category.name}» definitivamente?\n\nEsto no se puede deshacer. Si prefieres conservarla por si acaso, usa "Ocultar".`,
                )
              ) {
                deleteMutation.mutate();
              }
            }}
            className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
          >
            Borrar
          </button>
        </span>
      </div>
    </div>
  );
}
