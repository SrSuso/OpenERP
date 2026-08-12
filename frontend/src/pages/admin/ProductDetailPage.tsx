import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { useAuth } from '@/features/auth/AuthContext';
import {
  activateProduct,
  addBarcode,
  addPackage,
  deactivateProduct,
  deleteBarcode,
  posCategoriesQuery,
  productCategoriesQuery,
  productQuery,
  updateBarcode,
  updateProduct,
  type ProductUpdateInput,
} from '@/features/catalog/api';
import { EditProductForm } from '@/features/catalog/EditProductForm';
import { PackagesPanel } from '@/features/catalog/PackagesPanel';
import { ProductPurchaseHistoryTable } from '@/features/catalog/ProductPurchaseHistoryTable';
import { SupplierPurchaseSummary } from '@/features/catalog/SupplierPurchaseSummary';
import { stockBalanceQuery } from '@/features/inventory/api';
import { CreateLotForm } from '@/features/lots/CreateLotForm';
import { LotBalancesPanel } from '@/features/lots/LotBalancesPanel';
import { LotsTable } from '@/features/lots/LotsTable';
import { createLot, lotsQuery, type LotCreateInput } from '@/features/lots/api';
import { setProductPricing, taxesQuery, type PricingOverrideInput } from '@/features/pricing/api';
import { ProductFormulaPanel } from '@/features/pricing/ProductFormulaPanel';
import { PriceChangeDialog } from '@/features/pricing/PriceChangeDialog';
import { ProductPricingPanel } from '@/features/pricing/ProductPricingPanel';
import { productPurchaseHistoryQuery } from '@/features/purchasing/api';
import { suppliersQuery } from '@/features/suppliers/api';
import { ApiError } from '@/lib/api';
import { ImagePicker } from '@/features/images/ImagePicker';
import { formatQuantity } from '@/lib/format';

import { dangerAction, pageTitleRow, primaryAction } from './pageActions';
import { confirmDiscard } from '@/lib/unsaved';

type Tab = 'general' | 'pricing' | 'packages' | 'lots' | 'purchases';

const tabClassName = (active: boolean) =>
  `border-b-2 px-4 py-2 text-sm font-medium ${
    active
      ? 'border-brand-700 text-brand-700'
      : 'border-transparent text-slate-500 hover:text-slate-700'
  }`;

/** Ficha de producto — todo lo relacionado con un producto se edita desde
 * aquí, en pestañas (al estilo del formulario de producto de Odoo), en vez
 * de repartido entre filas expandibles y pantallas de otros módulos. Cada
 * pestaña sigue gateada por el permiso del módulo al que pertenece
 * (product.manage / pricing.manage / supplier.manage / lot.manage) — sólo
 * se reorganiza dónde vive el formulario, no quién puede usarlo. */
export function ProductDetailPage() {
  const { productId: productIdParam } = useParams<{ productId: string }>();
  const productId = Number(productIdParam);
  const { hasPermission } = useAuth();

  const canManageProduct = hasPermission('product.manage');
  const canManagePricing = hasPermission('pricing.manage');
  const canManageLots = hasPermission('lot.manage');

  const [tab, setTab] = useState<Tab>('general');
  // El panel de precios se teclea y no se guarda solo: cambiar de pestaña
  // se lo llevaría por delante sin decir nada.
  const [pricingDirty, setPricingDirty] = useState(false);
  const goToTab = (next: Tab) => {
    if (tab === 'pricing' && pricingDirty && !confirmDiscard()) return;
    if (tab === 'pricing') setPricingDirty(false);
    setTab(next);
  };
  const [editError, setEditError] = useState<string | null>(null);
  const [createLotError, setCreateLotError] = useState<string | null>(null);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);

  const product = useQuery(productQuery(productId));
  const categories = useQuery(productCategoriesQuery);
  const posCategories = useQuery(posCategoriesQuery);
  const taxes = useQuery(taxesQuery);
  const suppliers = useQuery(suppliersQuery(true));
  const stockBalances = useQuery(stockBalanceQuery({ productId }));
  const purchaseHistory = useQuery({
    ...productPurchaseHistoryQuery(productId),
    enabled: tab === 'purchases',
  });
  const lots = useQuery({ ...lotsQuery(productId), enabled: tab === 'lots' });
  const queryClient = useQueryClient();

  const invalidateProduct = () => {
    void queryClient.invalidateQueries({ queryKey: ['catalog', 'product', productId] });
    void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });
  };

  const updateMutation = useMutation({
    mutationFn: (payload: ProductUpdateInput) => updateProduct(productId, payload),
    onSuccess: () => {
      invalidateProduct();
      setEditError(null);
    },
    onError: () => setEditError('No se ha podido guardar el producto.'),
  });

  const deactivateMutation = useMutation({
    mutationFn: () => deactivateProduct(productId),
    onSuccess: invalidateProduct,
  });

  const activateMutation = useMutation({
    mutationFn: () => activateProduct(productId),
    onSuccess: invalidateProduct,
  });

  const savePricingMutation = useMutation({
    mutationFn: (input: PricingOverrideInput & { cost?: string }) =>
      setProductPricing(productId, input),
    onSuccess: () => {
      invalidateProduct();
      setProposedPricing(null);
    },
    onError: () => setProposedPricing(null),
  });

  // Cambiar el coste recalcula el PVP con la fórmula, así que acaba
  // tocando lo que se le cobra al cliente por lo que ya está en la
  // estantería: se pregunta antes (ver `PriceChangeDialog`).
  const [proposedPricing, setProposedPricing] = useState<
    (PricingOverrideInput & { cost?: string }) | null
  >(null);

  const addPackageMutation = useMutation({
    mutationFn: ({
      name,
      factor,
      barcode,
    }: {
      name: string;
      factor: string;
      barcode: string | null;
    }) => addPackage(productId, { name, factor, barcode }),
    onSuccess: invalidateProduct,
  });

  const barcodeConflictMessage = (err: unknown) =>
    err instanceof ApiError && err.code === 'conflict'
      ? 'Ese código de barras ya está asignado a otro producto.'
      : 'No se ha podido guardar el código de barras.';

  const addBarcodeMutation = useMutation({
    mutationFn: ({ packageId, barcode }: { packageId: number; barcode: string }) =>
      addBarcode(productId, packageId, barcode),
    onSuccess: () => {
      invalidateProduct();
      setBarcodeError(null);
    },
    onError: (err: unknown) => setBarcodeError(barcodeConflictMessage(err)),
  });

  const updateBarcodeMutation = useMutation({
    mutationFn: ({
      packageId,
      barcodeId,
      barcode,
    }: {
      packageId: number;
      barcodeId: number;
      barcode: string;
    }) => updateBarcode(productId, packageId, barcodeId, barcode),
    onSuccess: () => {
      invalidateProduct();
      setBarcodeError(null);
    },
    onError: (err: unknown) => setBarcodeError(barcodeConflictMessage(err)),
  });

  const deleteBarcodeMutation = useMutation({
    mutationFn: ({ packageId, barcodeId }: { packageId: number; barcodeId: number }) =>
      deleteBarcode(productId, packageId, barcodeId),
    onSuccess: () => {
      invalidateProduct();
      setBarcodeError(null);
    },
    onError: () => setBarcodeError('No se ha podido eliminar el código de barras.'),
  });

  const createLotMutation = useMutation({
    mutationFn: (payload: LotCreateInput) => createLot(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lots', 'list', productId] });
      setCreateLotError(null);
    },
    onError: () => setCreateLotError('No se ha podido crear el lote.'),
  });

  if (product.isPending) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (product.isError || !product.data) {
    return <p className="text-sm text-red-600">No se ha encontrado el producto.</p>;
  }

  const data = product.data;
  const totalStock = stockBalances.data?.reduce((sum, b) => sum + Number(b.quantity), 0) ?? null;

  return (
    <section>
      <Link
        to="/admin/inventory/products"
        className="mb-2 inline-block text-sm text-brand-700 hover:underline"
      >
        ← Volver a productos
      </Link>

      <div className={pageTitleRow}>
        <div className="flex items-center gap-3">
          <ImagePicker
            ownerType="product"
            ownerId={data.id}
            ownerName={data.name}
            canManage={canManageProduct}
            size="lg"
          />
          <div>
            <h1 className="text-2xl font-semibold">
              {data.name} <span className="font-mono text-base text-slate-400">{data.sku}</span>
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {data.category_name ?? 'Sin categoría'} · {data.is_active ? 'Activo' : 'Inactivo'} ·{' '}
              Stock: {totalStock === null ? '…' : `${formatQuantity(String(totalStock))} uds.`}
            </p>
          </div>
        </div>
        {canManageProduct && data.is_active && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`¿Desactivar «${data.name}»? Dejará de venderse en el TPV.`)) {
                deactivateMutation.mutate();
              }
            }}
            disabled={deactivateMutation.isPending}
            className={dangerAction}
          >
            Desactivar
          </button>
        )}
        {canManageProduct && !data.is_active && (
          <button
            type="button"
            onClick={() => activateMutation.mutate()}
            disabled={activateMutation.isPending}
            className={primaryAction}
          >
            Reactivar
          </button>
        )}
      </div>

      <nav
        className="mb-6 flex flex-wrap gap-2 border-b border-slate-200"
        aria-label="Ficha de producto"
      >
        <button
          type="button"
          onClick={() => goToTab('general')}
          className={tabClassName(tab === 'general')}
        >
          General
        </button>
        {canManagePricing && (
          <button
            type="button"
            onClick={() => goToTab('pricing')}
            className={tabClassName(tab === 'pricing')}
          >
            Precios
          </button>
        )}
        <button
          type="button"
          onClick={() => goToTab('packages')}
          className={tabClassName(tab === 'packages')}
        >
          Formatos
        </button>
        {data.track_lots && (
          <button
            type="button"
            onClick={() => goToTab('lots')}
            className={tabClassName(tab === 'lots')}
          >
            Lotes
          </button>
        )}
        <button
          type="button"
          onClick={() => goToTab('purchases')}
          className={tabClassName(tab === 'purchases')}
        >
          Compras
        </button>
      </nav>

      {tab === 'general' && (
        <EditProductForm
          product={data}
          categories={categories.data ?? []}
          posCategories={posCategories.data ?? []}
          isPending={updateMutation.isPending}
          submitError={editError}
          onCancel={() => setEditError(null)}
          onSubmit={(payload) => updateMutation.mutate(payload)}
        />
      )}

      {proposedPricing !== null && proposedPricing.cost !== undefined && (
        <PriceChangeDialog
          productName={data.name}
          what="coste"
          current={data.cost}
          next={proposedPricing.cost}
          unitName={data.base_unit_name}
          note="El PVP se recalculará solo, con el margen de este producto o el de su categoría."
          stock={totalStock === null ? null : String(totalStock)}
          isPending={savePricingMutation.isPending}
          onCancel={() => setProposedPricing(null)}
          onConfirm={() => savePricingMutation.mutate(proposedPricing)}
        />
      )}

      {tab === 'pricing' && canManagePricing && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <ProductPricingPanel
            product={data}
            category={categories.data?.find((c) => c.id === data.category_id)}
            taxes={taxes.data ?? []}
            isSaving={savePricingMutation.isPending}
            onDirtyChange={setPricingDirty}
            onSave={(input) => {
              // Sin tocar el coste no hay nada que avisar: el margen y los
              // impuestos se guardan directamente.
              if (input.cost !== undefined && Number(input.cost) !== Number(data.cost)) {
                setProposedPricing(input);
                return;
              }
              savePricingMutation.mutate(input);
            }}
          />
          <ProductFormulaPanel
            product={data}
            category={categories.data?.find((c) => c.id === data.category_id)}
            taxes={taxes.data ?? []}
            canManage={canManagePricing}
          />
        </div>
      )}

      {tab === 'packages' && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <PackagesPanel
            product={data}
            isAddingPackage={addPackageMutation.isPending}
            isAddingBarcode={addBarcodeMutation.isPending}
            isSavingBarcode={updateBarcodeMutation.isPending || deleteBarcodeMutation.isPending}
            barcodeError={barcodeError}
            onAddPackage={(name, factor, barcode) =>
              addPackageMutation.mutate({ name, factor, barcode })
            }
            onAddBarcode={(packageId, barcode) => addBarcodeMutation.mutate({ packageId, barcode })}
            onEditBarcode={(packageId, barcodeId, barcode) =>
              updateBarcodeMutation.mutate({ packageId, barcodeId, barcode })
            }
            onDeleteBarcode={(packageId, barcodeId) =>
              deleteBarcodeMutation.mutate({ packageId, barcodeId })
            }
          />
        </div>
      )}

      {tab === 'lots' && data.track_lots && (
        <div className="space-y-4">
          {canManageLots && (
            <CreateLotForm
              productId={productId}
              suppliers={suppliers.data ?? []}
              isPending={createLotMutation.isPending}
              submitError={createLotError}
              onSubmit={(payload) => createLotMutation.mutate(payload)}
            />
          )}
          {lots.data && <LotsTable lots={lots.data} />}
          <LotBalancesPanel productId={productId} canManage={canManageLots} />
        </div>
      )}

      {tab === 'purchases' && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          {purchaseHistory.data && (
            <>
              <h5 className="mb-1 text-xs font-semibold uppercase text-slate-500">
                Resumen por proveedor
              </h5>
              <SupplierPurchaseSummary entries={purchaseHistory.data} />
              <h5 className="mb-1 text-xs font-semibold uppercase text-slate-500">
                Historial completo
              </h5>
              <ProductPurchaseHistoryTable entries={purchaseHistory.data} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
