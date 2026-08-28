import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Alert, Button, Card } from '@/components/ui';
import { useAuth } from '@/features/auth/useAuth';
import {
  activateProduct,
  addBarcode,
  addPackage,
  deactivateProduct,
  deleteBarcode,
  deleteProduct,
  posCategoriesQuery,
  productCategoriesQuery,
  productQuery,
  unitsQuery,
  updateBarcode,
  updateProduct,
  type ProductUpdateInput,
} from '@/features/catalog/api';
import { EditProductForm } from '@/features/catalog/EditProductForm';
import {
  ProductInventoryAlertsForm,
  type ProductAlertUpdateConfig,
} from '@/features/catalog/ProductInventoryAlertsForm';
import { PackagesPanel } from '@/features/catalog/PackagesPanel';
import { ProductPurchaseHistoryTable } from '@/features/catalog/ProductPurchaseHistoryTable';
import { SupplierPurchaseSummary } from '@/features/catalog/SupplierPurchaseSummary';
import { stockBalanceQuery } from '@/features/inventory/api';
import { CreateLotForm } from '@/features/lots/CreateLotForm';
import { LotBalancesPanel } from '@/features/lots/LotBalancesPanel';
import { LotsTable } from '@/features/lots/LotsTable';
import { createLot, lotsQuery, type LotCreateInput } from '@/features/lots/api';
import {
  productPriceCalculationQuery,
  setProductPricing,
  taxesQuery,
  type PricingOverrideInput,
} from '@/features/pricing/api';
import { ProductFormulaPanel } from '@/features/pricing/ProductFormulaPanel';
import { PriceChangeDialog } from '@/features/pricing/PriceChangeDialog';
import { ProductPricingPanel } from '@/features/pricing/ProductPricingPanel';
import { productPurchaseHistoryQuery } from '@/features/purchasing/api';
import { suppliersQuery } from '@/features/suppliers/api';
import { ApiError } from '@/lib/api';
import { ImagePicker } from '@/features/images/ImagePicker';
import { formatQuantity } from '@/lib/format';
import {
  activeAlertsQuery,
  notificationSettingsQuery,
  removeProductExpiration,
  updateProductExpiration,
} from '@/features/notifications/api';

import { confirmDiscard } from '@/lib/unsaved';

type Tab = 'general' | 'pricing' | 'inventory' | 'packages' | 'purchases';

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
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  const canManageProduct = hasPermission('product.manage');
  const canManagePricing = hasPermission('pricing.manage');
  const canManageLots = hasPermission('lot.manage');
  const canReadNotifications = hasPermission('notification.read');
  const canManageNotifications = hasPermission('notification.manage');

  const [tab, setTab] = useState<Tab>('general');
  // General y precios se teclean y no se guardan solos: cambiar de pestaña
  // los desmontaría sin decir nada.
  const [generalDirty, setGeneralDirty] = useState(false);
  const [pricingDirty, setPricingDirty] = useState(false);
  const [inventoryDirty, setInventoryDirty] = useState(false);
  const goToTab = (next: Tab) => {
    if (next === tab) return;
    const hasUnsavedChanges =
      (tab === 'general' && generalDirty) ||
      (tab === 'pricing' && pricingDirty) ||
      (tab === 'inventory' && inventoryDirty);
    if (hasUnsavedChanges && !confirmDiscard()) return;
    if (tab === 'general') setGeneralDirty(false);
    if (tab === 'pricing') setPricingDirty(false);
    if (tab === 'inventory') setInventoryDirty(false);
    setTab(next);
  };
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [createLotError, setCreateLotError] = useState<string | null>(null);
  const [showCreateLot, setShowCreateLot] = useState(false);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [inventoryFeedback, setInventoryFeedback] = useState<string | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);

  const product = useQuery(productQuery(productId));
  const categories = useQuery(productCategoriesQuery);
  const posCategories = useQuery(posCategoriesQuery);
  const units = useQuery(unitsQuery);
  const taxes = useQuery(taxesQuery);
  const suppliers = useQuery(suppliersQuery(true));
  const stockBalances = useQuery(stockBalanceQuery({ productId }));
  const notificationSettings = useQuery({
    ...notificationSettingsQuery,
    enabled: canReadNotifications,
  });
  const activeAlerts = useQuery({ ...activeAlertsQuery, enabled: canReadNotifications });
  const purchaseHistory = useQuery({
    ...productPurchaseHistoryQuery(productId),
    enabled: tab === 'purchases',
  });
  const lots = useQuery({ ...lotsQuery(productId), enabled: tab === 'inventory' });
  const queryClient = useQueryClient();

  const invalidateProduct = () => {
    void queryClient.invalidateQueries({ queryKey: ['catalog', 'product', productId] });
    void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });
    void queryClient.invalidateQueries({
      queryKey: productPriceCalculationQuery(productId).queryKey,
    });
  };

  // Cuántas veces se ha guardado la ficha. Va como `key` del formulario:
  // guardar lo remonta, y así deja de contar como «tiene cambios sin
  // guardar» —si no, el aviso al cerrar y el «¿perder los cambios?» de
  // Cancelar seguirían saltando después de haber guardado—. Se remonta
  // sólo al guardar, no en cada recarga de la ficha: escribir mientras
  // llega una respuesta de fondo no borra nada.
  const [savedGeneral, setSavedGeneral] = useState(0);
  const [savedInventory, setSavedInventory] = useState(0);

  const updateMutation = useMutation({
    mutationFn: (payload: ProductUpdateInput) => updateProduct(productId, payload),
    onSuccess: (saved) => {
      // El producto guardado se mete en la caché *antes* de remontar el
      // formulario. Sin esto, remontar lo reiniciaba con lo que hubiera
      // cacheado, que todavía era lo de antes de guardar: la ficha se
      // quedaba enseñando el nombre viejo debajo de un título con el
      // nuevo, y volver a darle a Guardar devolvía el viejo. La respuesta
      // del PATCH ya trae el producto entero, así que no hay que esperar
      // a que llegue nada.
      queryClient.setQueryData(productQuery(productId).queryKey, saved);
      invalidateProduct();
      setEditError(null);
      setGeneralDirty(false);
      setSavedGeneral((count) => count + 1);
    },
    onError: (err: unknown) =>
      setEditError(err instanceof ApiError ? err.message : 'No se ha podido guardar el producto.'),
  });

  const inventoryMutation = useMutation({
    mutationFn: async ({
      productPayload,
      alerts,
    }: {
      productPayload: ProductUpdateInput;
      alerts: ProductAlertUpdateConfig;
    }) => {
      const saved =
        Object.keys(productPayload).length > 0
          ? await updateProduct(productId, productPayload)
          : product.data!;
      if (canManageNotifications) {
        const currentSpecific = notificationSettings.data?.product_expirations.some(
          (item) => item.product_id === productId,
        );
        try {
          if (saved.track_expiration && alerts.expirationMode === 'CUSTOM') {
            await updateProductExpiration(productId, alerts.expirationDays);
          } else if (currentSpecific) {
            await removeProductExpiration(productId);
          }
        } catch {
          return {
            saved,
            warning:
              'Los datos de inventario se han guardado, pero no el aviso de caducidad. Vuelve a intentarlo.',
          };
        }
      }
      return { saved, warning: null };
    },
    onSuccess: ({ saved, warning }) => {
      queryClient.setQueryData(productQuery(productId).queryKey, saved);
      invalidateProduct();
      void queryClient.invalidateQueries({ queryKey: notificationSettingsQuery.queryKey });
      void queryClient.invalidateQueries({ queryKey: activeAlertsQuery.queryKey });
      setInventoryDirty(false);
      setInventoryError(warning);
      setInventoryFeedback(warning ? null : 'Inventario y avisos guardados.');
      setSavedInventory((count) => count + 1);
    },
    onError: (err: unknown) => {
      setInventoryFeedback(null);
      setInventoryError(
        err instanceof ApiError
          ? err.message
          : 'No se han podido guardar el inventario y los avisos.',
      );
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: () => deactivateProduct(productId),
    onSuccess: invalidateProduct,
  });

  const activateMutation = useMutation({
    mutationFn: () => activateProduct(productId),
    onSuccess: invalidateProduct,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProduct(productId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });
      void navigate('/admin/inventory/products');
    },
    onError: (err: unknown) =>
      setDeleteError(
        err instanceof ApiError ? err.message : 'No se ha podido eliminar el producto.',
      ),
  });

  const [savedPricing, setSavedPricing] = useState(0);

  const savePricingMutation = useMutation({
    mutationFn: (input: PricingOverrideInput & { cost?: string }) =>
      setProductPricing(productId, input),
    onSuccess: (saved) => {
      // El PATCH de precios ya devuelve el coste, impuestos y PVP
      // recalculado. Guardarlo primero evita que la ficha siga mostrando
      // el precio anterior mientras una recarga lenta llega por detrás.
      queryClient.setQueryData(productQuery(productId).queryKey, saved);
      invalidateProduct();
      setPricingDirty(false);
      // Coste/impuestos/márgenes son estado local del panel. Al volver a
      // montarlo con la respuesta confirmada se ven las normalizaciones del
      // backend (decimales, impuestos efectivos y PVP), no valores viejos.
      setSavedPricing((count) => count + 1);
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
      setShowCreateLot(false);
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
        className="mb-4 inline-block rounded text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        ← Productos
      </Link>

      <Card className="mb-6 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <ImagePicker
            ownerType="product"
            ownerId={data.id}
            ownerName={data.name}
            canManage={canManageProduct}
            size="lg"
          />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold text-slate-950 sm:text-3xl">{data.name}</h1>
            <p className="mt-1 text-sm text-slate-600">{data.category_name ?? 'Sin categoría'}</p>
            <p className="mt-2 text-sm font-semibold text-slate-800">
              Stock:{' '}
              {totalStock === null
                ? '—'
                : `${formatQuantity(String(totalStock))} ${data.base_unit_name}`}
              {!data.is_active && (
                <span className="ml-3 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                  Inactivo
                </span>
              )}
            </p>
          </div>
        </div>
      </Card>

      {deleteError && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {deleteError}
        </p>
      )}

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
        <button
          type="button"
          onClick={() => goToTab('inventory')}
          className={tabClassName(tab === 'inventory')}
        >
          Inventario y avisos
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
        <button
          type="button"
          onClick={() => goToTab('purchases')}
          className={tabClassName(tab === 'purchases')}
        >
          Compras
        </button>
      </nav>

      {tab === 'general' && (
        <div className="space-y-6">
          <EditProductForm
            key={savedGeneral}
            product={data}
            categories={categories.data ?? []}
            posCategories={posCategories.data ?? []}
            units={units.data ?? []}
            isPending={updateMutation.isPending}
            submitError={editError}
            onCancel={() => setEditError(null)}
            onDirtyChange={setGeneralDirty}
            onSubmit={(payload) => updateMutation.mutate(payload)}
          />
          {canManageProduct && (
            <Card className="border-red-100 p-5 sm:p-6">
              <h2 className="text-lg font-bold text-slate-900">Estado y acciones avanzadas</h2>
              <p className="mt-1 text-sm text-slate-600">
                Estas acciones no forman parte de la edición habitual del producto.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                {data.is_active ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (
                        window.confirm(`¿Desactivar «${data.name}»? Dejará de venderse en el TPV.`)
                      ) {
                        deactivateMutation.mutate();
                      }
                    }}
                    disabled={deactivateMutation.isPending}
                  >
                    Desactivar producto
                  </Button>
                ) : (
                  <Button
                    onClick={() => activateMutation.mutate()}
                    disabled={activateMutation.isPending}
                  >
                    Reactivar producto
                  </Button>
                )}
                <Button
                  variant="danger"
                  onClick={() => {
                    if (
                      window.confirm(
                        `¿Eliminar definitivamente «${data.name}»? Sólo es posible si no tiene historial ni existencias.`,
                      )
                    ) {
                      setDeleteError(null);
                      deleteMutation.mutate();
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  Eliminar definitivamente
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === 'inventory' && (
        <div className="space-y-6">
          {!canReadNotifications && (
            <Alert tone="warning">
              Tu perfil no puede ver la configuración de avisos. Los controles de inventario siguen
              disponibles desde un perfil autorizado.
            </Alert>
          )}
          {canReadNotifications && notificationSettings.isPending && (
            <p className="text-sm text-slate-500">Cargando inventario y avisos…</p>
          )}
          {canReadNotifications && notificationSettings.isError && (
            <Alert tone="error">No se ha podido cargar la configuración de avisos.</Alert>
          )}
          {(notificationSettings.data || !canReadNotifications) && (
            <ProductInventoryAlertsForm
              key={savedInventory}
              product={data}
              category={categories.data?.find((item) => item.id === data.category_id)}
              settings={
                notificationSettings.data ?? {
                  stock_general: { enabled: false, min_stock: '0' },
                  general_expiration: { enabled: false, days_before_expiration: 7 },
                  product_expirations: [],
                }
              }
              totalStock={totalStock}
              hasLowStockAlert={(activeAlerts.data ?? []).some(
                (alert) => alert.kind === 'LOW_STOCK' && alert.product_id === data.id,
              )}
              canManageProduct={canManageProduct}
              canReadNotifications={canReadNotifications}
              canManageNotifications={canManageNotifications}
              isPending={inventoryMutation.isPending}
              feedback={inventoryFeedback}
              submitError={inventoryError}
              onDirtyChange={setInventoryDirty}
              onSubmit={(productPayload, alerts) => {
                setInventoryFeedback(null);
                setInventoryError(null);
                inventoryMutation.mutate({ productPayload, alerts });
              }}
            />
          )}
          {data.track_lots && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-900">Lotes del producto</h2>
                {canManageLots && !showCreateLot && (
                  <Button variant="secondary" onClick={() => setShowCreateLot(true)}>
                    + Nuevo lote
                  </Button>
                )}
              </div>
              <div className="mt-5 space-y-4">
                {canManageLots && showCreateLot && (
                  <CreateLotForm
                    products={[data]}
                    suppliers={suppliers.data ?? []}
                    initialProductId={productId}
                    isPending={createLotMutation.isPending}
                    submitError={createLotError}
                    onCancel={() => {
                      setShowCreateLot(false);
                      setCreateLotError(null);
                    }}
                    onSubmit={(payload) => createLotMutation.mutate(payload)}
                  />
                )}
                {lots.data && (
                  <LotsTable
                    lots={lots.data}
                    productNames={new Map([[data.id, data.name]])}
                    alertDaysByLot={
                      new Map(
                        (activeAlerts.data ?? [])
                          .filter(
                            (alert) =>
                              alert.kind === 'EXPIRATION' &&
                              alert.lot_id !== null &&
                              alert.days_remaining !== null,
                          )
                          .map((alert) => [alert.lot_id!, alert.days_remaining!]),
                      )
                    }
                  />
                )}
                <LotBalancesPanel
                  productId={productId}
                  productName={data.name}
                  canManage={canManageLots}
                />
              </div>
            </div>
          )}
        </div>
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
            key={savedPricing}
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
