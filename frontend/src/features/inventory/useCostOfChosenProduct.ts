import { useEffect, useRef } from 'react';

import { type Product } from '@/features/catalog/api';
import { decimalInputValue } from '@/lib/decimal';

/** Rellena el "Coste/ud." con el coste que el producto tiene ahora mismo,
 * cada vez que se elige otro producto. Sigue siendo un campo normal: lo que
 * se teclee encima manda, y no se vuelve a tocar mientras no se cambie de
 * producto — un ajuste puede querer valorarse a otro coste (una rotura de
 * mercancía comprada más barata, un recuento de existencias viejas).
 *
 * Deja de mirar el producto en cuanto se deselecciona, para no borrar de
 * golpe lo que hubiera escrito. */
export function useCostOfChosenProduct(
  productId: string | undefined,
  products: readonly Product[],
  setCost: (value: string) => void,
): void {
  const setCostRef = useRef(setCost);
  setCostRef.current = setCost;

  const cost = products.find((product) => String(product.id) === productId)?.cost;

  useEffect(() => {
    if (cost === undefined) return;
    setCostRef.current(decimalInputValue(cost));
  }, [cost, productId]);
}
