import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import { Cart } from '@/features/pos/Cart';
import { CategoryTabs } from '@/features/pos/CategoryTabs';
import { Checkout } from '@/features/pos/Checkout';
import { OpenSalesBar } from '@/features/pos/OpenSalesBar';
import { ProductGrid } from '@/features/pos/ProductGrid';
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
  warehousesQuery,
  type Product,
  type Sale,
  type SaleLine,
  type Tender,
} from '@/features/pos/api';
import { useShopSetting } from '@/features/settings/useShopSettings';
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
      // Se añade a las que ya hay, no se sustituyen: puede haber varias
      // abiertas a la vez (un cliente que se va a buscar algo y mientras
      // se cobra a otro). La caché es de donde lee el efecto de más abajo,
      // así que una entrada obsoleta aquí resucitaría una venta que ya no
      // existe.
      if (warehouseId !== null) {
        queryClient.setQueryData(draftSalesQuery(warehouseId).queryKey, (current) => [
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

  // Reanuda una venta abierta de esta caja, o abre la primera — recargar
  // la página no puede dejar huérfano un carrito a medias. Se ejecuta una
  // vez por cada `sale` vacío (el propio `isOpeningSale` corta la
  // reentrada); que vuelva a saltar después de cobrar o cancelar es
  // justamente lo que hace falta, porque es cuando hay que pasar a otra.
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
    if (warehouseId === null) return;
    queryClient.setQueryData(draftSalesQuery(warehouseId).queryKey, (current) =>
      (current ?? []).map((candidate) => (candidate.id === updated.id ? updated : candidate)),
    );
  }

  /** Quita de la lista de abiertas la que se acaba de cerrar (cobrada o
   * cancelada) y deja como activa otra, si queda alguna. Si no queda
   * ninguna, el efecto de arriba abre una nueva. */
  function closeSale(closedId: number) {
    let remaining: Sale[] = [];
    if (warehouseId !== null) {
      queryClient.setQueryData(draftSalesQuery(warehouseId).queryKey, (current) => {
        remaining = (current ?? []).filter((candidate) => candidate.id !== closedId);
        return remaining;
      });
    }
    setSale(remaining[0] ?? null);
  }

  const categories = useQuery(posCategoriesQuery);
  const products = useQuery(
    productsQuery(selectedCategoryId !== null ? { posCategoryId: selectedCategoryId } : {}),
  );

  const addLineMutation = useMutation({
    mutationFn: ({ product, quantity }: { product: Product; quantity: string }) =>
      addLine(sale!.id, {
        product_id: product.id,
        package_id: basePackage(product).id,
        quantity_packages: quantity,
      }),
    onSuccess: (updated) => {
      setLineError(null);
      syncSale(updated);
      setWeighing(null);
    },
    onError: (error) => setLineError(describeError(error)),
  });

  // Los productos que se venden pesando (KG por defecto, ver el ajuste) no
  // se pueden vender de un toque: nadie compra exactamente un kilo. Al
  // pulsarlos se pregunta cuántos gramos, y esto es el que está esperando.
  const weighedUnits = useShopSetting('pos.weighed_units', 'KG')
    .split(',')
    .map((unit) => unit.trim().toUpperCase())
    .filter((unit) => unit !== '');
  const [weighing, setWeighing] = useState<{ product: Product; barcode?: string } | null>(null);

  // Lo tecleado en el multiplicador, vacío mientras no se toque (= una
  // unidad). Se limpia al añadir: es para el siguiente producto, no un modo
  // en el que quedarse.
  const [pendingQuantity, setPendingQuantity] = useState('');

  function pickProduct(product: Product) {
    if (weighedUnits.includes(product.base_unit_name.toUpperCase())) {
      // Lo que se pesa lleva su propia cantidad, en gramos.
      setWeighing({ product });
      return;
    }
    addLineMutation.mutate({ product, quantity: pendingQuantity === '' ? '1' : pendingQuantity });
    setPendingQuantity('');
  }

  const addBarcodeLineMutation = useMutation({
    mutationFn: ({ code, quantity }: { code: string; quantity: string }) =>
      addLineByBarcode(sale!.id, { barcode: code, quantity_packages: quantity }),
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
      if (weighedUnits.includes(product.base_unit_name.toUpperCase())) {
        setWeighing({ product, barcode: code });
        return;
      }
      addBarcodeLineMutation.mutate({
        code,
        quantity: pendingQuantity === '' ? '1' : pendingQuantity,
      });
      setPendingQuantity('');
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
    mutationFn: (line: SaleLine) => removeLine(sale!.id, line.id),
    onSuccess: (updated) => {
      setLineError(null);
      syncSale(updated);
    },
    onError: (error) => setLineError(describeError(error)),
  });

  const cancelMutation = useMutation({
    mutationFn: (saleId: number) => cancelSale(saleId),
    onSuccess: (_result, saleId) => closeSale(saleId),
    onError: (error) => setLineError(describeError(error)),
  });

  const checkoutMutation = useMutation({
    mutationFn: (payments: Tender[]) => checkout(sale!.id, payments),
    onSuccess: (completed) => {
      setCheckoutError(null);
      setReceipt(completed);
      closeSale(completed.id);
      setView('cart');
    },
    onError: (error) => setCheckoutError(describeError(error)),
  });

  const busy =
    addLineMutation.isPending ||
    resolveBarcodeMutation.isPending ||
    addBarcodeLineMutation.isPending ||
    removeLineMutation.isPending ||
    cancelMutation.isPending;

  // El lector, sin tener que pinchar antes en ningún recuadro: escanear es
  // el gesto más repetido de una caja y no puede pedir un clic previo.
  // Mientras el foco esté en un campo (teclear un código a mano, los gramos
  // de lo que se pesa) manda el campo — lo decide el propio hook.
  useBarcodeScanner(
    (code) => resolveBarcodeMutation.mutate(code),
    sale !== null && !busy && view === 'cart' && weighing === null,
  );

  function handleBarcodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = barcode.trim();
    if (code !== '' && sale !== null) {
      resolveBarcodeMutation.mutate(code);
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
                  <div className="flex min-h-0 flex-1 flex-col">
                    <OpenSalesBar
                      sales={draftSales.data ?? []}
                      activeId={sale?.id ?? null}
                      onSelect={(picked) => {
                        setSale(picked);
                        setLineError(null);
                      }}
                      onOpenNew={() => openSale()}
                      disabled={busy || isOpeningSale}
                    />
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
                          onPick={pickProduct}
                          disabled={sale === null || busy}
                        />
                        {/* Debajo de la cuadrícula, que es lo que se pulsa
                          justo después de teclear la cantidad. */}
                        <QuantityPad value={pendingQuantity} onChange={setPendingQuantity} />
                      </div>

                      <Cart
                        sale={sale}
                        disabled={busy}
                        onRemoveLine={(line) => removeLineMutation.mutate(line)}
                        onCancelSale={() => cancelMutation.mutate(sale!.id)}
                        onCheckout={() => {
                          setCheckoutError(null);
                          setView('checkout');
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
              ? addLineMutation.mutate({ product: weighing.product, quantity })
              : addBarcodeLineMutation.mutate({ code: weighing.barcode, quantity })
          }
        />
      )}
    </section>
  );
}
