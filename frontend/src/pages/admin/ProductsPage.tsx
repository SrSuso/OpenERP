import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import {
  addBarcode,
  addPackage,
  createProduct,
  deactivateProduct,
  posCategoriesQuery,
  productCategoriesQuery,
  productsQuery,
  unitsQuery,
  updateProduct,
  type Product,
  type ProductCreateInput,
  type ProductUpdateInput,
} from '@/features/catalog/api';
import { CreateProductForm } from '@/features/catalog/CreateProductForm';
import { EditProductForm } from '@/features/catalog/EditProductForm';
import { PackagesPanel } from '@/features/catalog/PackagesPanel';
import { ProductsTable, type ProductPanel } from '@/features/catalog/ProductsTable';
import { setProductPricing, taxesQuery, type PricingOverrideInput } from '@/features/pricing/api';
import { ProductPricingPanel } from '@/features/pricing/ProductPricingPanel';
import { ApiError } from '@/lib/api';

export function ProductsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('product.manage');

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [expanded, setExpanded] = useState<{ productId: number; panel: ProductPanel } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

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
    mutationFn: (payload: ProductCreateInput) => createProduct(payload),
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

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ProductUpdateInput }) =>
      updateProduct(id, payload),
    onSuccess: () => {
      invalidateProducts();
      setEditingProduct(null);
      setEditError(null);
    },
    onError: () => setEditError('No se ha podido guardar el producto.'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => deactivateProduct(id),
    onSuccess: invalidateProducts,
  });

  const addPackageMutation = useMutation({
    mutationFn: ({
      productId,
      name,
      factor,
      barcode,
    }: {
      productId: number;
      name: string;
      factor: string;
      barcode: string | null;
    }) => addPackage(productId, { name, factor, barcode }),
    onSuccess: invalidateProducts,
  });

  const addBarcodeMutation = useMutation({
    mutationFn: ({
      productId,
      packageId,
      barcode,
    }: {
      productId: number;
      packageId: number;
      barcode: string;
    }) => addBarcode(productId, packageId, barcode),
    onSuccess: invalidateProducts,
  });

  const savePricingMutation = useMutation({
    mutationFn: ({
      productId,
      input,
    }: {
      productId: number;
      input: PricingOverrideInput & { cost?: string };
    }) => setProductPricing(productId, input),
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
          isPending={createMutation.isPending}
          submitError={createError}
          onCancel={() => {
            setShowCreateForm(false);
            setCreateError(null);
          }}
          onSubmit={(payload) => createMutation.mutate(payload)}
        />
      )}

      {editingProduct && (
        <EditProductForm
          product={editingProduct}
          categories={categories.data ?? []}
          posCategories={posCategories.data ?? []}
          isPending={updateMutation.isPending}
          submitError={editError}
          onCancel={() => {
            setEditingProduct(null);
            setEditError(null);
          }}
          onSubmit={(payload) => updateMutation.mutate({ id: editingProduct.id, payload })}
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
          expanded={expanded}
          onToggleExpand={(productId, panel) =>
            setExpanded((current) =>
              current?.productId === productId && current.panel === panel
                ? null
                : { productId, panel },
            )
          }
          onEdit={(product) => {
            setEditingProduct(product);
            setEditError(null);
          }}
          onDeactivate={(id) => deactivateMutation.mutate(id)}
          isDeactivating={deactivateMutation.isPending}
          renderExpanded={(product, panel) =>
            panel === 'packages' ? (
              <PackagesPanel
                product={product}
                isAddingPackage={addPackageMutation.isPending}
                isAddingBarcode={addBarcodeMutation.isPending}
                onAddPackage={(name, factor, barcode) =>
                  addPackageMutation.mutate({ productId: product.id, name, factor, barcode })
                }
                onAddBarcode={(packageId, barcode) =>
                  addBarcodeMutation.mutate({ productId: product.id, packageId, barcode })
                }
              />
            ) : (
              <ProductPricingPanel
                product={product}
                category={categories.data?.find((c) => c.id === product.category_id)}
                taxes={taxes.data ?? []}
                isSaving={savePricingMutation.isPending}
                onSave={(input) => savePricingMutation.mutate({ productId: product.id, input })}
              />
            )
          }
        />
      )}
    </div>
  );
}
