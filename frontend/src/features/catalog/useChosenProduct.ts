import { useEffect, useRef } from 'react';

import { type Product } from '@/features/catalog/api';

/** Rellena campos con lo que sabemos del producto en cuanto se elige otro
 * (o en cuanto llega la lista, si ya había uno elegido). Lo usan el coste
 * de un ajuste de stock y el coste/IVA de una línea de compra.
 *
 * Los campos siguen siendo normales: lo que se teclee encima manda, porque
 * esto sólo se dispara al cambiar de producto, no cada vez que la lista se
 * refresca por detrás.
 *
 * Devuelve el producto elegido, que es lo que suele hacer falta al lado
 * (enseñar su coste actual, sus formatos…). */
export function useChosenProduct(
  productId: string | undefined,
  products: readonly Product[],
  apply: (product: Product) => void,
): Product | undefined {
  const chosen = products.find((product) => String(product.id) === productId);

  const applyRef = useRef(apply);
  applyRef.current = apply;

  const chosenId = chosen?.id;
  useEffect(() => {
    if (chosenId === undefined) return;
    const product = products.find((candidate) => candidate.id === chosenId);
    if (product) applyRef.current(product);
    // `products` a propósito fuera: un refresco de la lista no debe volver
    // a pisar lo que haya escrito quien rellena el formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenId]);

  return chosen;
}
