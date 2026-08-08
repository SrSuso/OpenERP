import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import { Cart } from '@/features/pos/Cart';
import { CategoryTabs } from '@/features/pos/CategoryTabs';
import { Checkout } from '@/features/pos/Checkout';
import { ProductGrid } from '@/features/pos/ProductGrid';
import { Receipt } from '@/features/pos/Receipt';
import {
  addLine,
  addLineByBarcode,
  basePackage,
  cancelSale,
  checkout,
  createSale,
  draftSalesQuery,
  locationsQuery,
  posCategoriesQuery,
  productsQuery,
  removeLine,
  warehousesQuery,
  type Product,
  type Sale,
  type SaleLine,
  type Tender,
} from '@/features/pos/api';
import { ApiError } from '@/lib/api';

function describeError(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Ha ocurrido un error inesperado.';
}

/**
 * The till (phase 12): resolve where this register sells from, resume or
 * open a `DRAFT` sale (phase 11's cart), and let the cashier build it by
 * tapping the product grid (phases 3/10) or scanning a barcode. Charging
 * the sale is deliberately not here — that is phase 13's checkout, on top
 * of the very same `DRAFT` sale this screen builds.
 */
export function PosHomePage() {
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [barcode, setBarcode] = useState('');
  const [sale, setSale] = useState<Sale | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);
  const [view, setView] = useState<'cart' | 'checkout'>('cart');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  //: The sale just completed, kept only long enough to show its receipt —
  //: independent of `sale`, which by then has already gone back to `null`
  //: so the effect below can open the next one.
  const [receipt, setReceipt] = useState<Sale | null>(null);

  const warehouses = useQuery(warehousesQuery);
  const warehouseId = warehouses.data?.[0]?.id ?? null;

  const locations = useQuery(locationsQuery(warehouseId ?? Number.NaN));
  const locationId = locations.data?.[0]?.id ?? null;

  const draftSales = useQuery(draftSalesQuery(warehouseId));
  const queryClient = useQueryClient();

  const openSaleMutation = useMutation({
    mutationFn: () => createSale(warehouseId as number, locationId as number),
    onSuccess: (created) => {
      // Keep the draft-sales cache in sync with what we just did, rather
      // than only holding it in local `sale` state — the resume effect
      // below reads straight from this cache, so a stale entry there would
      // make it resurrect a sale that no longer reflects the backend.
      if (warehouseId !== null) {
        queryClient.setQueryData(draftSalesQuery(warehouseId).queryKey, [created]);
      }
      setSale(created);
    },
  });
  const {
    isPending: isOpeningSale,
    isError: failedToOpenSale,
    mutate: openSale,
  } = openSaleMutation;

  // Resume the cashier's own open sale for this till, or open a new one —
  // a page reload must not orphan an in-progress cart. Runs once per empty
  // `sale` (guarded by `isOpeningSale`, so the in-flight request itself
  // blocks re-entry); firing again after a cancel is intentional, since
  // that is exactly when a fresh sale is needed.
  useEffect(() => {
    if (sale !== null || warehouseId === null || locationId === null) {
      return;
    }
    if (draftSales.data === undefined) {
      return;
    }
    const [existing] = draftSales.data;
    if (existing) {
      setSale(existing);
      return;
    }
    if (!isOpeningSale && !failedToOpenSale) {
      openSale();
    }
  }, [sale, warehouseId, locationId, draftSales.data, isOpeningSale, failedToOpenSale, openSale]);

  const categories = useQuery(posCategoriesQuery);
  const products = useQuery(
    productsQuery(selectedCategoryId !== null ? { posCategoryId: selectedCategoryId } : {}),
  );

  const addLineMutation = useMutation({
    mutationFn: (product: Product) =>
      addLine(sale!.id, {
        product_id: product.id,
        package_id: basePackage(product).id,
        quantity_packages: '1',
      }),
    onSuccess: (updated) => {
      setLineError(null);
      setSale(updated);
    },
    onError: (error) => setLineError(describeError(error)),
  });

  const addBarcodeMutation = useMutation({
    mutationFn: (code: string) => addLineByBarcode(sale!.id, code),
    onSuccess: (updated) => {
      setLineError(null);
      setSale(updated);
      setBarcode('');
    },
    onError: (error) => setLineError(describeError(error)),
  });

  const removeLineMutation = useMutation({
    mutationFn: (line: SaleLine) => removeLine(sale!.id, line.id),
    onSuccess: (updated) => {
      setLineError(null);
      setSale(updated);
    },
    onError: (error) => setLineError(describeError(error)),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelSale(sale!.id),
    // The effect above opens a fresh sale as soon as `sale` goes back to
    // null — but only once the draft-sales cache no longer lists the one
    // we just cancelled, or it would resurrect it straight back.
    onSuccess: () => {
      if (warehouseId !== null) {
        queryClient.setQueryData(draftSalesQuery(warehouseId).queryKey, []);
      }
      setSale(null);
    },
    onError: (error) => setLineError(describeError(error)),
  });

  const checkoutMutation = useMutation({
    mutationFn: (payments: Tender[]) => checkout(sale!.id, payments),
    // Same cache-sync reasoning as cancel: clear the draft-sales cache so
    // the resume effect opens a genuinely new sale instead of resurrecting
    // the one that was just completed.
    onSuccess: (completed) => {
      if (warehouseId !== null) {
        queryClient.setQueryData(draftSalesQuery(warehouseId).queryKey, []);
      }
      setCheckoutError(null);
      setReceipt(completed);
      setSale(null);
      setView('cart');
    },
    onError: (error) => setCheckoutError(describeError(error)),
  });

  const busy =
    addLineMutation.isPending ||
    addBarcodeMutation.isPending ||
    removeLineMutation.isPending ||
    cancelMutation.isPending;

  function handleBarcodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = barcode.trim();
    if (code !== '' && sale !== null) {
      addBarcodeMutation.mutate(code);
    }
  }

  const sessionLoading =
    warehouses.isPending ||
    (warehouseId !== null && locations.isPending) ||
    (warehouseId !== null && draftSales.isPending);
  const sessionErrored = warehouses.isError || locations.isError || draftSales.isError;

  return (
    <section className="flex h-full flex-col">
      <h1 className="sr-only">Punto de venta</h1>

      {sessionLoading && (
        <p className="flex flex-1 items-center justify-center text-slate-400">
          Preparando el punto de venta…
        </p>
      )}

      {!sessionLoading && sessionErrored && (
        <p className="flex flex-1 items-center justify-center text-red-400">
          No se ha podido preparar el punto de venta. Recarga la página.
        </p>
      )}

      {!sessionLoading && !sessionErrored && warehouseId === null && (
        <p className="flex flex-1 items-center justify-center text-slate-400">
          No hay ningún almacén activo configurado.
        </p>
      )}

      {!sessionLoading && !sessionErrored && warehouseId !== null && locationId === null && (
        <p className="flex flex-1 items-center justify-center text-slate-400">
          El almacén no tiene ninguna ubicación activa.
        </p>
      )}

      {!sessionLoading && !sessionErrored && warehouseId !== null && locationId !== null && (
        <>
          {receipt !== null ? (
            <Receipt sale={receipt} onDismiss={() => setReceipt(null)} />
          ) : (
            <>
              {failedToOpenSale && sale === null && (
                <p className="flex flex-1 items-center justify-center gap-3 text-red-400">
                  No se ha podido abrir la venta.
                  <button
                    type="button"
                    onClick={() => openSale()}
                    className="rounded bg-slate-700 px-3 py-1.5 text-sm font-medium text-slate-50 hover:bg-slate-600"
                  >
                    Reintentar
                  </button>
                </p>
              )}

              {sale !== null && view === 'checkout' ? (
                <Checkout
                  sale={sale}
                  isPending={checkoutMutation.isPending}
                  error={checkoutError}
                  onConfirm={(payments) => checkoutMutation.mutate(payments)}
                  onBack={() => setView('cart')}
                />
              ) : (
                (sale !== null || (!failedToOpenSale && isOpeningSale)) && (
                  <div className="flex min-h-0 flex-1">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <form
                        onSubmit={handleBarcodeSubmit}
                        className="flex gap-2 border-b border-slate-700 p-3"
                      >
                        <label htmlFor="pos-barcode" className="sr-only">
                          Código de barras
                        </label>
                        <input
                          id="pos-barcode"
                          type="text"
                          value={barcode}
                          onChange={(event) => setBarcode(event.target.value)}
                          placeholder="Escanear o introducir código de barras"
                          disabled={sale === null || busy}
                          className="flex-1 rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-50 disabled:opacity-50"
                        />
                        <button
                          type="submit"
                          disabled={sale === null || busy || barcode.trim() === ''}
                          className="rounded bg-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Añadir
                        </button>
                      </form>

                      {lineError && (
                        <p
                          role="alert"
                          className="border-b border-red-900 bg-red-950/50 px-4 py-2 text-sm text-red-300"
                        >
                          {lineError}
                        </p>
                      )}

                      <CategoryTabs
                        categories={categories.data ?? []}
                        selectedId={selectedCategoryId}
                        onSelect={setSelectedCategoryId}
                      />
                      <ProductGrid
                        products={products.data ?? []}
                        isPending={products.isPending}
                        isError={products.isError}
                        onPick={(product) => addLineMutation.mutate(product)}
                        disabled={sale === null || busy}
                      />
                    </div>

                    <Cart
                      sale={sale}
                      disabled={busy}
                      onRemoveLine={(line) => removeLineMutation.mutate(line)}
                      onCancelSale={() => cancelMutation.mutate()}
                      onCheckout={() => {
                        setCheckoutError(null);
                        setView('checkout');
                      }}
                    />
                  </div>
                )
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
