import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { createProductCategory, productCategoriesQuery } from '@/features/catalog/api';
import { ApiError } from '@/lib/api';

/** Categorías de estantería (independientes de las categorías POS del TPV
 * — ver `PosCategoriesPanel`). Solo alta: no hay endpoint para
 * desactivarlas todavía en el backend. */
export function ProductCategoriesPanel({ canManage }: { canManage: boolean }) {
  const categories = useQuery(productCategoriesQuery);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

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

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate(name.trim());
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Categorías de producto</h3>

      {categories.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      <ul className="mb-3 flex flex-wrap gap-2">
        {categories.data?.map((category) => (
          <li
            key={category.id}
            className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700"
          >
            {category.name}
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
