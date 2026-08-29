import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Cart } from '@/features/pos/Cart';
import { CategoryTabs } from '@/features/pos/CategoryTabs';
import { Checkout } from '@/features/pos/Checkout';
import { OpenSalesBar } from '@/features/pos/OpenSalesBar';
import { OpenPricePrompt } from '@/features/pos/OpenPricePrompt';
import { usePosHeaderActions } from '@/features/pos/PosHeaderActionsContext';
import { ProductGrid } from '@/features/pos/ProductGrid';
import { ProductSearchDialog } from '@/features/pos/ProductSearchDialog';
import { QuantityPad } from '@/features/pos/QuantityPad';
import { Receipt } from '@/features/pos/Receipt';
import { WeightPrompt } from '@/features/pos/WeightPrompt';
import { useBarcodeScanner } from '@/features/pos/useBarcodeScanner';
import {
  addLine,
  addLineByBarcode,
  basePackage,
  cancelSale,
  findProductByBarcode,
  checkout,
  createSale,
  draftSalesQuery,
  locationsQuery,
  posCategoriesQuery,
  productsQuery,
  removeLine,
  validateSaleStock,
  type Product,
  type Sale,
  type SaleLine,
  type Tender,
} from '@/features/pos/api';
import { usePosTerminal } from '@/features/pos/usePosTerminal';
import { useShopSetting } from '@/features/settings/useShopSettings';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';

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
  const { registerNewSaleAction, rememberLastTicket } = usePosHeaderActions();
  const { selectedTerminal } = usePosTerminal();
  const terminalId = selectedTerminal?.id ?? null;
  const coldDrinkSurcharge = useShopSetting('pos.cold_drink_surcharge_amount', '0');
  const coldDrinkSurchargeEnabled = Number(coldDrinkSurcharge) > 0;
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [initialCategoryResolved, setInitialCategoryResolved] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [isProductSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [sale, setSale] = useState<Sale | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);
  const [coldDrinkNext, setColdDrinkNext] = useState(false);
  const [cancelConfirmationOpen, setCancelConfirmationOpen] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [view, setView] = useState<'cart' | 'checkout'>('cart');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  // One key per checkout intention. It survives a transport/timeout retry,
  // and is discarded only after success, leaving checkout, or changing sale.
  const checkoutAttemptRef = useRef<{ saleId: number; key: string } | null>(null);
  //: The sale just completed, kept only long enough to show its receipt —
  //: independent of `sale`, which by then has already gone back to `null`
  //: so the effect below can open the next one.
  const [receipt, setReceipt] = useState<Sale | null>(null);

  const warehouseId = selectedTerminal?.warehouse_id ?? null;
  const showProductSearch = selectedTerminal?.show_product_search ?? true;

  const locations = useQuery(locationsQuery(warehouseId ?? Number.NaN));
  const locationId = locations.data?.[0]?.id ?? null;

  const draftSales = useQuery(draftSalesQuery(terminalId, warehouseId));
  const queryClient = useQueryClient();

  const openSaleMutation = useMutation({
    mutationFn: () => createSale(terminalId as number, warehouseId as number, locationId as number),
    onSuccess: (created) => {
      // Se añade a las que ya hay, no se sustituyen: puede haber varias
      // abiertas a la vez (un cliente que se va a buscar algo y mientras
      // se cobra a otro). La caché es de donde lee el efecto de más abajo,
      // así que una entrada obsoleta aquí resucitaría una venta que ya no
      // existe.
      if (warehouseId !== null) {
        queryClient.setQueryData(draftSalesQuery(terminalId, warehouseId).queryKey, (current) => [
          ...(current ?? []),
          created,
        ]);
      }
      setSale(created);
    },
  });
  const {
    isPending: isOpeningSale,
    isError: failedToOpenSale,
    mutate: openSale,
  } = openSaleMutation;

  // Reanuda la venta abierta más reciente de esta caja, o abre una nueva —
  // las demás siguen explícitamente en OpenSalesBar. Recargar la página no
  // puede dejar huérfano un carrito a medias. Se ejecuta una
  // vez por cada `sale` vacío (el propio `isOpeningSale` corta la
  // reentrada); que vuelva a saltar después de cobrar o cancelar es
  // justamente lo que hace falta, porque es cuando hay que pasar a otra.
  useEffect(() => {
    if (sale !== null || terminalId === null || warehouseId === null || locationId === null) {
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
  }, [
    sale,
    terminalId,
    warehouseId,
    locationId,
    draftSales.data,
    isOpeningSale,
    failedToOpenSale,
    openSale,
  ]);

  /** Guarda la venta que acaba de devolver el servidor: como activa y, a la
   * vez, en la lista de abiertas.
   *
   * Las dos cosas, siempre. La barra de arriba pinta cada venta con sus
   * líneas y su total leyendo de esa lista, así que actualizar sólo la
   * activa dejaba las demás congeladas en como estaban al cargar la
   * pantalla: al saltar a otra faltaban los productos que ya se le habían
   * metido y el total no era el suyo. */
  function syncSale(updated: Sale) {
    setSale(updated);
    setStockError(null);
    if (warehouseId === null) return;
    queryClient.setQueryData(draftSalesQuery(terminalId, warehouseId).queryKey, (current) =>
      (current ?? []).map((candidate) => (candidate.id === updated.id ? updated : candidate)),
    );
  }

  /** Quita de la lista de abiertas la que se acaba de cerrar (cobrada o
   * cancelada) y deja como activa otra, si queda alguna. Si no queda
   * ninguna, el efecto de arriba abre una nueva. */
  function closeSale(closedId: number) {
    let remaining: Sale[] = [];
    if (warehouseId !== null) {
      queryClient.setQueryData(draftSalesQuery(terminalId, warehouseId).queryKey, (current) => {
        remaining = (current ?? []).filter((candidate) => candidate.id !== closedId);
        return remaining;
      });
    }
    setSale(remaining[0] ?? null);
    setStockError(null);
  }

  const categories = useQuery(posCategoriesQuery);
  useEffect(() => {
    if (initialCategoryResolved || categories.data === undefined) return;
    setSelectedCategoryId(categories.data.find((category) => category.is_default)?.id ?? null);
    setInitialCategoryResolved(true);
  }, [categories.data, initialCategoryResolved]);
  const products = useQuery(
    productsQuery(selectedCategoryId !== null ? { posCategoryId: selectedCategoryId } : {}),
  );
  const searchedProducts = useQuery({
    ...productsQuery({ search: productSearch.trim() }),
    enabled: isProductSearchOpen && productSearch.trim() !== '',
  });

  const addLineMutation = useMutation({
    mutationFn: ({
      product,
      quantity,
      openPriceTotal,
      coldDrink,
    }: {
      product: Product;
      quantity: string;
      openPriceTotal?: string;
      coldDrink: boolean;
    }) =>
      addLine(sale!.id, terminalId as number, {
        product_id: product.id,
        package_id: basePackage(product).id,
        quantity_packages: quantity,
        ...(openPriceTotal === undefined ? {} : { open_price_total: openPriceTotal }),
        ...(coldDrink ? { cold_drink: true } : {}),
      }),
    onSuccess: (updated) => {
      setLineError(null);
      syncSale(updated);
      setWeighing(null);
      setOpenPrice(null);
    },
    onError: (error) => setLineError(describeError(error)),
  });

  const [weighing, setWeighing] = useState<{
    product: Product;
    barcode?: string;
    coldDrink: boolean;
  } | null>(null);
  const [openPrice, setOpenPrice] = useState<{ product: Product; coldDrink: boolean } | null>(null);

  // Lo tecleado en el multiplicador, vacío mientras no se toque (= una
  // unidad). Se limpia al añadir: es para el siguiente producto, no un modo
  // en el que quedarse.
  const [pendingQuantity, setPendingQuantity] = useState('');

  function pickProduct(product: Product) {
    const coldDrink = coldDrinkSurchargeEnabled && coldDrinkNext;
    if (product.is_open_price) {
      setOpenPrice({ product, coldDrink });
      setPendingQuantity('');
      setColdDrinkNext(false);
      return;
    }
    if (product.is_sold_by_weight) {
      // Lo que se pesa lleva su propia cantidad, en gramos.
      setWeighing({ product, coldDrink });
      setColdDrinkNext(false);
      return;
    }
    addLineMutation.mutate({
      product,
      quantity: pendingQuantity === '' ? '1' : pendingQuantity,
      coldDrink,
    });
    setPendingQuantity('');
    setColdDrinkNext(false);
  }

  const addBarcodeLineMutation = useMutation({
    mutationFn: ({
      code,
      quantity,
      coldDrink,
    }: {
      code: string;
      quantity: string;
      coldDrink: boolean;
    }) =>
      addLineByBarcode(sale!.id, terminalId as number, {
        barcode: code,
        quantity_packages: quantity,
        ...(coldDrink ? { cold_drink: true } : {}),
      }),
    onSuccess: (updated) => {
      setLineError(null);
      syncSale(updated);
      setWeighing(null);
    },
    onError: (error, { code }) => {
      setBarcode('');
      setWeighing(null);
      setLineError(
        error instanceof ApiError && error.status === 404
          ? `El código ${code} no está dado de alta en ningún producto.`
          : describeError(error),
      );
    },
  });

  // La prelectura sólo conserva el comportamiento existente de productos
  // pesados. La escritura posterior siempre manda el código: el backend
  // vuelve a resolver y guarda el formato exacto, el factor y el precio.
  const resolveBarcodeMutation = useMutation({
    mutationFn: (code: string) => findProductByBarcode(code),
    onSuccess: (product, code) => {
      setLineError(null);
      setBarcode('');
      const coldDrink = coldDrinkSurchargeEnabled && coldDrinkNext;
      if (product.is_sold_by_weight) {
        setWeighing({ product, barcode: code, coldDrink });
        setColdDrinkNext(false);
        return;
      }
      addBarcodeLineMutation.mutate({
        code,
        quantity: pendingQuantity === '' ? '1' : pendingQuantity,
        coldDrink,
      });
      setPendingQuantity('');
      setColdDrinkNext(false);
    },
    // Con el lector, el error que sale casi siempre es que ese código no
    // está dado de alta — y hay que decirlo con el código delante, para no
    // dejar a nadie mirando la pantalla sin saber qué ha leído la pistola.
    onError: (error, code) => {
      setBarcode('');
      setLineError(
        error instanceof ApiError && error.status === 404
          ? `El código ${code} no está dado de alta en ningún producto.`
          : describeError(error),
      );
    },
  });

  const removeLineMutation = useMutation({
    mutationFn: (line: SaleLine) => removeLine(sale!.id, line.id, terminalId as number),
    onSuccess: (updated) => {
      setLineError(null);
      syncSale(updated);
    },
    onError: (error) => setLineError(describeError(error)),
  });

  const cancelMutation = useMutation({
    mutationFn: (saleId: number) => cancelSale(saleId, terminalId as number),
    onSuccess: (_result, saleId) => {
      setCancelConfirmationOpen(false);
      closeSale(saleId);
    },
    onError: (error) => setLineError(describeError(error)),
  });

  const stockCheckMutation = useMutation({
    mutationFn: () => validateSaleStock(sale!.id, terminalId as number),
    onSuccess: () => {
      setStockError(null);
      setCheckoutError(null);
      setView('checkout');
    },
    onError: (error) => setStockError(describeError(error)),
  });

  const checkoutMutation = useMutation({
    mutationFn: ({ saleId, payments, key }: { saleId: number; payments: Tender[]; key: string }) =>
      checkout(saleId, payments, key, terminalId as number),
    onSuccess: (completed) => {
      checkoutAttemptRef.current = null;
      setCheckoutError(null);
      rememberLastTicket(completed.id);
      setReceipt(completed);
      closeSale(completed.id);
      setView('cart');
    },
    onError: (error) => {
      const message = describeError(error);
      if (error instanceof ApiError && error.details['reason'] === 'insufficient_stock') {
        checkoutAttemptRef.current = null;
        setStockError(message);
        setView('cart');
        return;
      }
      setCheckoutError(message);
    },
  });

  function confirmCheckout(payments: Tender[]) {
    if (sale === null || checkoutMutation.isPending) return;
    const existing = checkoutAttemptRef.current;
    const attempt =
      existing?.saleId === sale.id ? existing : { saleId: sale.id, key: crypto.randomUUID() };
    checkoutAttemptRef.current = attempt;
    checkoutMutation.mutate({ saleId: sale.id, payments, key: attempt.key });
  }

  function leaveCheckout() {
    checkoutAttemptRef.current = null;
    setView('cart');
  }

  const busy =
    addLineMutation.isPending ||
    resolveBarcodeMutation.isPending ||
    addBarcodeLineMutation.isPending ||
    removeLineMutation.isPending ||
    cancelMutation.isPending ||
    stockCheckMutation.isPending;

  useEffect(() => {
    // El recibo ya tiene su propia acción «Nueva venta», y durante el
    // cobro no se debe abrir otro carrito por error desde el encabezado.
    if (sale === null || view !== 'cart' || receipt !== null) return;
    return registerNewSaleAction({
      onPress: () => openSale(),
      disabled: busy || isOpeningSale,
    });
  }, [registerNewSaleAction, sale, view, receipt, busy, isOpeningSale, openSale]);

  // El lector, sin tener que pinchar antes en ningún recuadro: escanear es
  // el gesto más repetido de una caja y no puede pedir un clic previo.
  // Mientras el foco esté en un campo (teclear un código a mano, los gramos
  // de lo que se pesa) manda el campo — lo decide el propio hook.
  useBarcodeScanner(
    (code) => resolveBarcodeMutation.mutate(code),
    sale !== null &&
      !busy &&
      view === 'cart' &&
      weighing === null &&
      openPrice === null &&
      !isProductSearchOpen,
  );

  function handleBarcodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = barcode.trim();
    if (code !== '' && sale !== null) {
      resolveBarcodeMutation.mutate(code);
    }
  }

  const sessionLoading =
    (warehouseId !== null && locations.isPending) || (warehouseId !== null && draftSales.isPending);
  const sessionErrored = locations.isError || draftSales.isError;

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
                  onConfirm={confirmCheckout}
                  onBack={leaveCheckout}
                />
              ) : (
                (sale !== null || (!failedToOpenSale && isOpeningSale)) && (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <OpenSalesBar
                      sales={draftSales.data ?? []}
                      activeId={sale?.id ?? null}
                      onSelect={(picked) => {
                        checkoutAttemptRef.current = null;
                        setSale(picked);
                        setLineError(null);
                        setStockError(null);
                      }}
                    />
                    <div className="flex min-h-0 flex-1">
                      <div className="flex min-w-0 flex-1 flex-col">
                        <form
                          onSubmit={handleBarcodeSubmit}
                          className="flex gap-3 border-b border-slate-700 p-4"
                        >
                          <label htmlFor="pos-barcode" className="sr-only">
                            Código de barras
                          </label>
                          <input
                            id="pos-barcode"
                            type="text"
                            value={barcode}
                            onChange={(event) => setBarcode(event.target.value)}
                            onClick={() => {
                              if (!showProductSearch || sale === null || busy) return;
                              // En una pantalla táctil este recuadro es la entrada
                              // natural para buscar: abrir directamente el diálogo
                              // evita depender de un segundo botón o del teclado del SO.
                              setProductSearchOpen(true);
                            }}
                            placeholder="Escanear o introducir código de barras"
                            disabled={sale === null || busy}
                            className="min-h-14 flex-1 rounded border border-slate-600 bg-slate-900 px-4 py-3 text-lg text-slate-50 disabled:opacity-50"
                          />
                        </form>

                        {lineError && (
                          <p
                            role="alert"
                            className="border-b border-red-900 bg-red-950/50 px-4 py-2 text-sm text-red-300"
                          >
                            {lineError}
                          </p>
                        )}

                        {/* La cantidad se decide antes de elegir el artículo:
                          arriba del catálogo queda al alcance y se ve cuál
                          será el siguiente toque, sin buscarla al final de
                          la cuadrícula. */}
                        <QuantityPad value={pendingQuantity} onChange={setPendingQuantity} />
                        {coldDrinkSurchargeEnabled && (
                          <div className="border-b border-slate-700 p-3">
                            <button
                              type="button"
                              aria-pressed={coldDrinkNext}
                              onClick={() => setColdDrinkNext((selected) => !selected)}
                              disabled={busy}
                              className={`min-h-12 w-full rounded-lg border px-4 text-left text-base font-semibold transition disabled:opacity-50 ${
                                coldDrinkNext
                                  ? 'border-cyan-300 bg-cyan-400 text-slate-950'
                                  : 'border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700'
                              }`}
                            >
                              Bebida fría{' '}
                              <span className="ml-2 text-sm font-medium">
                                +{formatMoney(coldDrinkSurcharge)} por unidad
                              </span>
                            </button>
                          </div>
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
                          onPick={pickProduct}
                          disabled={sale === null || busy}
                        />
                      </div>

                      <Cart
                        sale={sale}
                        disabled={busy}
                        onRemoveLine={(line) => removeLineMutation.mutate(line)}
                        onCancelSale={() => setCancelConfirmationOpen(true)}
                        stockError={stockError}
                        isCheckingStock={stockCheckMutation.isPending}
                        onCheckout={() => {
                          checkoutAttemptRef.current = null;
                          setStockError(null);
                          setCheckoutError(null);
                          stockCheckMutation.mutate();
                        }}
                      />
                    </div>
                  </div>
                )
              )}
            </>
          )}
        </>
      )}

      {weighing !== null && (
        <WeightPrompt
          product={weighing.product}
          isPending={addLineMutation.isPending || addBarcodeLineMutation.isPending}
          onCancel={() => setWeighing(null)}
          onConfirm={(quantity) =>
            weighing.barcode === undefined
              ? addLineMutation.mutate({
                  product: weighing.product,
                  quantity,
                  coldDrink: weighing.coldDrink,
                })
              : addBarcodeLineMutation.mutate({
                  code: weighing.barcode,
                  quantity,
                  coldDrink: weighing.coldDrink,
                })
          }
        />
      )}

      {openPrice !== null && (
        <OpenPricePrompt
          product={openPrice.product}
          isPending={addLineMutation.isPending}
          onCancel={() => setOpenPrice(null)}
          onConfirm={(total) =>
            addLineMutation.mutate({
              product: openPrice.product,
              quantity: '1',
              openPriceTotal: total,
              coldDrink: openPrice.coldDrink,
            })
          }
        />
      )}

      {cancelConfirmationOpen && sale !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-sale-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
        >
          <section className="w-full max-w-sm rounded-xl border border-red-900 bg-slate-800 p-5 shadow-2xl">
            <h2 id="cancel-sale-title" className="text-lg font-semibold text-slate-50">
              ¿Cancelar esta venta?
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              Se eliminarán los artículos de este carrito. Esta acción no se puede deshacer.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setCancelConfirmationOpen(false)}
                disabled={cancelMutation.isPending}
                className="flex-1 rounded border border-slate-500 py-2.5 text-sm font-medium text-slate-100 disabled:opacity-50"
              >
                Seguir editando
              </button>
              <button
                type="button"
                onClick={() => cancelMutation.mutate(sale.id)}
                disabled={cancelMutation.isPending}
                className="flex-1 rounded bg-red-700 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
              >
                {cancelMutation.isPending ? 'Cancelando…' : 'Sí, cancelar venta'}
              </button>
            </div>
          </section>
        </div>
      )}

      {isProductSearchOpen && (
        <ProductSearchDialog
          query={productSearch}
          onQueryChange={setProductSearch}
          products={searchedProducts.data ?? []}
          isPending={searchedProducts.isPending}
          isError={searchedProducts.isError}
          disabled={sale === null || busy}
          onPick={(product) => {
            setProductSearchOpen(false);
            setProductSearch('');
            pickProduct(product);
          }}
          onClose={() => {
            setProductSearchOpen(false);
            setProductSearch('');
          }}
        />
      )}
    </section>
  );
}
