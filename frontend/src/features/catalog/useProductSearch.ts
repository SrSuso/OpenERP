import { useEffect, useRef, useState } from 'react';

import { type Product } from '@/features/catalog/api';

/** ¿Encaja el producto con lo que se ha escrito? Nombre, SKU o cualquiera
 * de sus códigos de barras (los de todos sus formatos: brik y caja de 6
 * llevan códigos distintos y las dos cosas son el mismo producto). */
export function productMatches(product: Product, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  if (product.name.toLowerCase().includes(needle)) return true;
  if (product.sku.toLowerCase().includes(needle)) return true;
  return product.packages.some((pkg) =>
    pkg.barcodes.some((barcode) => barcode.barcode.toLowerCase().includes(needle)),
  );
}

/** Buscador para los desplegables de producto: escribiendo (o pasando el
 * lector por la etiqueta) se recorta la lista a lo que encaje. Sin esto,
 * un desplegable sólo se recorre por el principio del texto, que es el SKU
 * —una referencia interna que nadie se sabe de memoria— mientras que el
 * código de barras está impreso en el propio producto.
 *
 * Con `onSingleMatch`, en cuanto queda un único producto se elige solo: es
 * justo lo que pasa al pasar el lector, y obligar a desplegar una lista de
 * uno sería un paso de más. */
export function useProductSearch(
  products: readonly Product[],
  options: { onSingleMatch?: (productId: string) => void } = {},
) {
  const [query, setQuery] = useState('');
  const matches = products.filter((product) => productMatches(product, query));

  const onSingleMatch = options.onSingleMatch;
  const callbackRef = useRef(onSingleMatch);
  callbackRef.current = onSingleMatch;

  // Sólo el id, para que el efecto dependa de un valor y no de la identidad
  // del array recién filtrado.
  const onlyId = query.trim() !== '' && matches.length === 1 ? String(matches[0]!.id) : null;
  useEffect(() => {
    if (onlyId === null) return;
    callbackRef.current?.(onlyId);
  }, [onlyId]);

  return { query, setQuery, matches };
}
