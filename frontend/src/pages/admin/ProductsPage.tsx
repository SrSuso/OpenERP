import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import {
  createProduct,
  deactivateProduct,
  posCategoriesQuery,
  productCategoriesQuery,
  productsQuery,
  unitsQuery,
  type ProductCreateInput,
} from '@/features/catalog/api';
import { CreateProductForm } from '@/features/catalog/CreateProductForm';
import { ProductsTable } from '@/features/catalog/ProductsTable';
import { setProductPricing, taxesQuery } from '@/features/pricing/api';
import { ApiError } from '@/lib/api';

export function ProductsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('product.manage');

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const categories = useQuery(productCategoriesQuery);
  const posCategories = useQuery(posCategoriesQuery);
  const units = useQuery(unitsQuery);
  const taxes = useQuery(taxesQuery);
  const products = useQuery(
    productsQuery({
      ...(search ? { search } : {}),
      ...(categoryId !== '' ? { categoryId: Number(categoryId) } : {}),
      activeOnly: !showInactive,
    }),
  );
  const queryClient = useQueryClient();

  const invalidateProducts = () =>
    void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });

  const createMutation = useMutation({
    mutationFn: async ({ payload, taxIds }: { payload: ProductCreateInput; taxIds: number[] }) => {
      const created = await createProduct(payload);
      // Los impuestos no van en el alta (ProductCreate no los acepta,
      // ver ProductCreateInput's propio comentario) — un segundo PATCH
      // inmediatamente después, sólo si se eligió alguno.
      if (taxIds.length > 0) {
        await setProductPricing(created.id, { tax_ids: taxIds });
      }
      return created;
    },
    onSuccess: () => {
      invalidateProducts();
      setShowCreateForm(false);
      setCreateError(null);
    },
    onError: (error: unknown) => {
      setCreateError(
        error instanceof ApiError && error.code === 'conflict'
          ? 'Ya existe un producto con ese SKU.'
          : 'No se ha podido crear el producto.',
      );
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => deactivateProduct(id),
    onSuccess: invalidateProducts,
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-600">
            Buscar
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre o SKU…"
              className="mt-1 block w-48 rounded border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm text-slate-600">
            Categoría
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="mt-1 block rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="">Todas</option>
              {categories.data?.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 pb-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
            />
            Incluir inactivos
          </label>
        </div>

        {canManage && !showCreateForm && (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            Nuevo producto
          </button>
        )}
      </div>

      {showCreateForm && (
        <CreateProductForm
          categories={categories.data ?? []}
          posCategories={posCategories.data ?? []}
          units={units.data ?? []}
          taxes={taxes.data ?? []}
          isPending={createMutation.isPending}
          submitError={createError}
          onCancel={() => {
            setShowCreateForm(false);
            setCreateError(null);
          }}
          onSubmit={(payload, taxIds) => createMutation.mutate({ payload, taxIds })}
        />
      )}

      {products.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {products.isError && (
        <p className="text-sm text-red-600">No se han podido cargar los productos.</p>
      )}

      {products.data && (
        <ProductsTable
          products={products.data}
          canManage={canManage}
          onDeactivate={(id) => deactivateMutation.mutate(id)}
          isDeactivating={deactivateMutation.isPending}
        />
      )}
    </div>
  );
}
