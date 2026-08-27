import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useAuth } from '@/features/auth/useAuth';
import {
  createProduct,
  posCategoriesQuery,
  productCategoriesQuery,
  productsQuery,
  unitsQuery,
  type Product,
  type ProductCreateInput,
} from '@/features/catalog/api';
import { CreateProductForm } from '@/features/catalog/CreateProductForm';
import { ProductsTable } from '@/features/catalog/ProductsTable';
import { stockTotalsQuery } from '@/features/inventory/api';
import { PriceChangeDialog } from '@/features/pricing/PriceChangeDialog';
import { setManualPrice, setProductPricing, taxesQuery } from '@/features/pricing/api';
import { ApiError } from '@/lib/api';

import { pageHeaderRow, primaryAction } from './pageActions';

export function ProductsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('product.manage');

  const canManagePricing = hasPermission('pricing.manage');

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  // Para repasar de un vistazo lo que se vende por peso ("KG") y teclear los
  // precios del día. Se filtra aquí y no en el servidor porque la lista ya
  // viene entera (`list_products` no pagina) y `base_unit_name` viene en cada
  // producto: un filtro más en la API no aportaría nada.
  const [unitName, setUnitName] = useState('');
  //: '' = todas; 'none' = las que no están en ningún botón del TPV, que es
  //: justo lo que se repasa al montar la caja.
  const [posCategoryFilter, setPosCategoryFilter] = useState('');
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
          ? 'Ya existe un producto con esos datos.'
          : 'No se ha podido crear el producto.',
      );
    },
  });

  const [savedPriceId, setSavedPriceId] = useState<number | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  // El cambio tecleado, esperando a que se confirme: el precio nuevo se
  // aplica también a lo que ya está en la estantería, así que se pregunta
  // antes de guardarlo.
  const [proposedPrice, setProposedPrice] = useState<{
    product: Product;
    listPrice: string;
  } | null>(null);

  const priceMutation = useMutation({
    mutationFn: ({ id, listPrice }: { id: number; listPrice: string }) =>
      setManualPrice(id, listPrice),
    onSuccess: (_product, { id }) => {
      invalidateProducts();
      setSavedPriceId(id);
      setPriceError(null);
      setProposedPrice(null);
    },
    onError: () => {
      setSavedPriceId(null);
      setPriceError('No se ha podido guardar el precio.');
      setProposedPrice(null);
    },
  });

  // Lo mismo con el coste, que es lo que se apunta al recibir el género:
  // aquí el PVP no se teclea, sale solo del margen del producto (o del de
  // su categoría). Por eso son dos mutaciones y no una: el PVP se fija tal
  // cual y el coste recalcula.
  const [savedCostId, setSavedCostId] = useState<number | null>(null);
  const [proposedCost, setProposedCost] = useState<{ product: Product; cost: string } | null>(null);

  const costMutation = useMutation({
    mutationFn: ({ id, cost }: { id: number; cost: string }) => setProductPricing(id, { cost }),
    onSuccess: (_product, { id }) => {
      invalidateProducts();
      setSavedCostId(id);
      setPriceError(null);
      setProposedCost(null);
    },
    onError: () => {
      setSavedCostId(null);
      setPriceError('No se ha podido guardar el coste.');
      setProposedCost(null);
    },
  });

  // El total de stock por producto vive en inventario y tiene su propio
  // permiso: quien no pueda verlo sigue viendo la lista, con la columna en
  // blanco.
  // El «Guardado» verde de la fila es un acuse de recibo, no un estado: se
  // va solo. Quedándose puesto, al rato la lista entera parecía recién
  // tocada y dejaba de decir nada.
  useEffect(() => {
    if (savedPriceId === null && savedCostId === null) return;
    const timer = setTimeout(() => {
      setSavedPriceId(null);
      setSavedCostId(null);
    }, 2500);
    return () => clearTimeout(timer);
  }, [savedPriceId, savedCostId]);

  const stockTotals = useQuery({ ...stockTotalsQuery, enabled: hasPermission('inventory.read') });
  const stockByProduct = stockTotals.data
    ? new Map(stockTotals.data.map((total) => [total.product_id, total.quantity]))
    : null;

  const visibleProducts = (products.data ?? []).filter(
    (product) =>
      (unitName === '' || product.base_unit_name === unitName) &&
      (posCategoryFilter === '' ||
        (posCategoryFilter === 'none'
          ? product.pos_category_id === null
          : product.pos_category_id === Number(posCategoryFilter))),
  );

  return (
    <div>
      <div className={pageHeaderRow}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-600">
            Buscar
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre o código de barras…"
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
          <label className="text-sm text-slate-600">
            Unidad
            <select
              value={unitName}
              onChange={(event) => setUnitName(event.target.value)}
              className="mt-1 block rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="">Todas</option>
              {units.data?.map((unit) => (
                <option key={unit.id} value={unit.name}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-600">
            Categoría POS
            <select
              value={posCategoryFilter}
              onChange={(event) => setPosCategoryFilter(event.target.value)}
              className="mt-1 block rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="">Todas</option>
              <option value="none">Sin asignar</option>
              {posCategories.data?.map((category) => (
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
          <button type="button" onClick={() => setShowCreateForm(true)} className={primaryAction}>
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

      {priceError && <p className="mb-2 text-sm text-red-600">{priceError}</p>}

      {proposedPrice !== null && (
        <PriceChangeDialog
          productName={proposedPrice.product.name}
          what="PVP"
          current={proposedPrice.product.list_price}
          next={proposedPrice.listPrice}
          unitName={proposedPrice.product.base_unit_name}
          stock={
            stockByProduct === null ? null : (stockByProduct.get(proposedPrice.product.id) ?? '0')
          }
          isPending={priceMutation.isPending}
          onCancel={() => setProposedPrice(null)}
          onConfirm={() =>
            priceMutation.mutate({
              id: proposedPrice.product.id,
              listPrice: proposedPrice.listPrice,
            })
          }
        />
      )}

      {proposedCost !== null && (
        <PriceChangeDialog
          productName={proposedCost.product.name}
          what="coste"
          current={proposedCost.product.cost}
          next={proposedCost.cost}
          unitName={proposedCost.product.base_unit_name}
          note="El PVP se recalculará solo, con el margen de este producto o el de su categoría."
          stock={
            stockByProduct === null ? null : (stockByProduct.get(proposedCost.product.id) ?? '0')
          }
          isPending={costMutation.isPending}
          onCancel={() => setProposedCost(null)}
          onConfirm={() =>
            costMutation.mutate({ id: proposedCost.product.id, cost: proposedCost.cost })
          }
        />
      )}

      {products.data && (
        <ProductsTable
          products={visibleProducts}
          canManagePricing={canManagePricing}
          stockByProduct={stockByProduct}
          onSetPrice={(product, listPrice) => setProposedPrice({ product, listPrice })}
          savingPriceId={priceMutation.isPending ? priceMutation.variables.id : null}
          savedPriceId={savedPriceId}
          onSetCost={(product, cost) => setProposedCost({ product, cost })}
          savingCostId={costMutation.isPending ? costMutation.variables.id : null}
          savedCostId={savedCostId}
        />
      )}
    </div>
  );
}
