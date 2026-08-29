import { useState } from 'react';

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
 * código de barras está impreso en el propio producto. Filtrar nunca escoge
 * una opción por su cuenta: incluso una única coincidencia debe aparecer en
 * el desplegable para que la persona confirme qué producto quiere usar. */
export function useProductSearch(products: readonly Product[]) {
  const [query, setQuery] = useState('');
  const matches = products.filter((product) => productMatches(product, query));

  return { query, setQuery, matches };
}
