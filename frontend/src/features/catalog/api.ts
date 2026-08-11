import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// --- impuestos, tal y como los ve un producto/categoría (el CRUD real,
// crear/listar impuestos con su nombre y tasa, vive en features/pricing) ---

export const productTaxSchema = z.object({
  id: z.number(),
  name: z.string(),
  rate: z.string(),
});
export type ProductTax = z.infer<typeof productTaxSchema>;

// --- categorías de producto (estanterías, independientes de las de POS) ---

export const productCategorySchema = z.object({
  id: z.number(),
  name: z.string(),
  is_active: z.boolean(),
  // Por defecto para todos los productos de la categoría — un producto con
  // su propio valor explícito lo pisa (ver docs/ARCHITECTURE.md, módulo
  // Precios). Se gestionan desde features/pricing (PATCH .../pricing), no
  // desde aquí.
  margin_rate: z.string().nullable(),
  taxes: z.array(productTaxSchema),
});
export type ProductCategory = z.infer<typeof productCategorySchema>;

export const productCategoriesQuery = queryOptions({
  queryKey: ['catalog', 'product-categories'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/product-categories`, {
      schema: z.array(productCategorySchema),
      signal,
    }),
});

export async function createProductCategory(name: string): Promise<ProductCategory> {
  return apiFetch(`${API_V1}/product-categories`, {
    method: 'POST',
    schema: productCategorySchema,
    body: { name },
  });
}

/** Renombrar una ya creada — mismo id, así que los productos que la
 * tienen asignada la conservan. */
export async function renameProductCategory(id: number, name: string): Promise<ProductCategory> {
  return apiFetch(`${API_V1}/product-categories/${id}`, {
    method: 'PATCH',
    schema: productCategorySchema,
    body: { name },
  });
}

/** Ocultar una categoría: deja de ofrecerse al clasificar productos, pero
 * los que ya la tienen la conservan. Reversible. */
export async function deactivateProductCategory(id: number): Promise<ProductCategory> {
  return apiFetch(`${API_V1}/product-categories/${id}/deactivate`, {
    method: 'POST',
    schema: productCategorySchema,
  });
}

export async function activateProductCategory(id: number): Promise<ProductCategory> {
  return apiFetch(`${API_V1}/product-categories/${id}/activate`, {
    method: 'POST',
    schema: productCategorySchema,
  });
}

/** Borrado de verdad. El backend lo rechaza (409) si algún producto la
 * usa — en ese caso hay que ocultarla, que conserva el dato. */
export async function deleteProductCategory(id: number): Promise<void> {
  await apiFetch(`${API_V1}/product-categories/${id}`, { method: 'DELETE', schema: z.null() });
}

// --- unidades (lista gestionada para el desplegable "unidad base") --------

export const unitSchema = z.object({
  id: z.number(),
  name: z.string(),
  display_order: z.number(),
});
export type Unit = z.infer<typeof unitSchema>;

// Ya viene ordenada del backend (display_order, name) — el propio orden de
// la lista es el orden que se ve en el desplegable de "unidad base".
export const unitsQuery = queryOptions({
  queryKey: ['catalog', 'units'] as const,
  queryFn: ({ signal }) => apiFetch(`${API_V1}/units`, { schema: z.array(unitSchema), signal }),
});

export async function createUnit(name: string): Promise<Unit> {
  return apiFetch(`${API_V1}/units`, { method: 'POST', schema: unitSchema, body: { name } });
}

export async function moveUnit(id: number, direction: 'up' | 'down'): Promise<Unit[]> {
  return apiFetch(`${API_V1}/units/${id}/move`, {
    method: 'POST',
    schema: z.array(unitSchema),
    body: { direction },
  });
}

// --- categorías POS (botones/pestañas del TPV, fase 10) -------------------

export const posCategorySchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
  display_order: z.number(),
  is_active: z.boolean(),
});
export type PosCategory = z.infer<typeof posCategorySchema>;

export const posCategoriesQuery = queryOptions({
  queryKey: ['catalog', 'pos-categories'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/pos-categories?active_only=false`, {
      schema: z.array(posCategorySchema),
      signal,
    }),
});

export interface PosCategoryCreate {
  name: string;
  color: string;
  display_order: number;
}

export async function createPosCategory(payload: PosCategoryCreate): Promise<PosCategory> {
  return apiFetch(`${API_V1}/pos-categories`, {
    method: 'POST',
    schema: posCategorySchema,
    body: payload,
  });
}

export async function updatePosCategory(
  id: number,
  payload: Partial<PosCategoryCreate>,
): Promise<PosCategory> {
  return apiFetch(`${API_V1}/pos-categories/${id}`, {
    method: 'PATCH',
    schema: posCategorySchema,
    body: payload,
  });
}

export async function deactivatePosCategory(id: number): Promise<PosCategory> {
  return apiFetch(`${API_V1}/pos-categories/${id}/deactivate`, {
    method: 'POST',
    schema: posCategorySchema,
  });
}

/** El camino de vuelta de `deactivatePosCategory`: sin él, esconder una
 * por error obligaba a crear otra igual y reasignarle los productos. */
export async function activatePosCategory(id: number): Promise<PosCategory> {
  return apiFetch(`${API_V1}/pos-categories/${id}/activate`, {
    method: 'POST',
    schema: posCategorySchema,
  });
}

/** Borrado de verdad. El backend lo rechaza (409) si algún producto la
 * usa — en ese caso hay que ocultarla. */
export async function deletePosCategory(id: number): Promise<void> {
  await apiFetch(`${API_V1}/pos-categories/${id}`, { method: 'DELETE', schema: z.null() });
}

// --- productos, presentaciones y códigos de barras -------------------------

export const barcodeSchema = z.object({
  id: z.number(),
  barcode: z.string(),
});
export type Barcode = z.infer<typeof barcodeSchema>;

export const packageSchema = z.object({
  id: z.number(),
  name: z.string(),
  factor: z.string(),
  is_base: z.boolean(),
  barcodes: z.array(barcodeSchema),
});
export type Package = z.infer<typeof packageSchema>;

export const productSchema = z.object({
  id: z.number(),
  // Nunca se teclea (ver ProductCreateInput) — generado por el backend
  // ("P000123") como referencia interna que usan ventas/compras/
  // inventario/lotes, no algo que se gestione desde el panel.
  sku: z.string(),
  name: z.string(),
  description: z.string(),
  category_id: z.number().nullable(),
  category_name: z.string().nullable(),
  pos_category_id: z.number().nullable(),
  pos_category_name: z.string().nullable(),
  pos_display_order: z.number(),
  base_unit_name: z.string(),
  cost: z.string(),
  list_price: z.string(),
  tax_rate: z.string(),
  surcharge_rate: z.string(),
  // El tipo que de verdad se le aplica, ya resuelto por el backend
  // (propios → los de su categoría → `tax_rate`): es lo que debe salir por
  // defecto al comprarlo. `tax_rate` a secas es sólo el valor suelto.
  effective_tax_rate: z.string(),
  // null = hereda el margen de la categoría (o 0 si tampoco la categoría
  // tiene uno) — ver ProductCategory.margin_rate.
  margin_rate: z.string().nullable(),
  // Vacío = hereda los impuestos de la categoría, no "sin impuestos".
  taxes: z.array(productTaxSchema),
  price_formula: z.string().nullable(),
  min_stock: z.string(),
  track_lots: z.boolean(),
  track_expiration: z.boolean(),
  is_active: z.boolean(),
  packages: z.array(packageSchema),
});
export type Product = z.infer<typeof productSchema>;

export interface ProductFilters {
  categoryId?: number;
  posCategoryId?: number;
  activeOnly?: boolean;
  search?: string;
}

export function productQuery(id: number) {
  return queryOptions({
    queryKey: ['catalog', 'product', id] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/products/${id}`, { schema: productSchema, signal }),
  });
}

export function productsQuery(filters: ProductFilters) {
  const params = new URLSearchParams();
  if (filters.categoryId !== undefined) params.set('category_id', String(filters.categoryId));
  if (filters.posCategoryId !== undefined) {
    params.set('pos_category_id', String(filters.posCategoryId));
  }
  params.set('active_only', String(filters.activeOnly ?? true));
  if (filters.search) params.set('search', filters.search);

  return queryOptions({
    queryKey: ['catalog', 'products', filters] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/products?${params.toString()}`, {
        schema: z.array(productSchema),
        signal,
      }),
  });
}

/** No `sku` (autogenerado por el backend) ni `tax_rate` (los impuestos se
 * eligen del catálogo de features/pricing, nunca un número suelto) —
 * `list_price` sigue siendo manual aquí: el formulario la calcula en vivo
 * con `POST /pricing/preview` y manda el resultado, así que crear un
 * producto nunca sobreescribe en silencio lo que se ve en pantalla. Cambios
 * de precio posteriores son el camino exclusivo de `features/pricing` (ver
 * backend/app/catalog/schemas.py's `ProductUpdate`). */
export interface ProductCreateInput {
  name: string;
  description: string;
  category_id: number | null;
  pos_category_id: number | null;
  pos_display_order: number;
  base_unit_name: string;
  base_barcode: string | null;
  cost: string;
  list_price: string;
  margin_rate: string | null;
  min_stock: string;
  track_lots: boolean;
  track_expiration: boolean;
}

export async function createProduct(payload: ProductCreateInput): Promise<Product> {
  return apiFetch(`${API_V1}/products`, {
    method: 'POST',
    schema: productSchema,
    body: payload,
  });
}

/** Catalog-only fields — never cost/price/tax (see `ProductCreateInput`'s
 * own docstring). */
export interface ProductUpdateInput {
  name?: string;
  description?: string;
  category_id?: number | null;
  pos_category_id?: number | null;
  pos_display_order?: number;
  min_stock?: string;
  track_lots?: boolean;
  track_expiration?: boolean;
}

export async function updateProduct(id: number, payload: ProductUpdateInput): Promise<Product> {
  return apiFetch(`${API_V1}/products/${id}`, {
    method: 'PATCH',
    schema: productSchema,
    body: payload,
  });
}

export async function deactivateProduct(id: number): Promise<Product> {
  return apiFetch(`${API_V1}/products/${id}/deactivate`, {
    method: 'POST',
    schema: productSchema,
  });
}

/** El otro lado de la regla 14 ("se desactiva, nunca se borra"): un
 * producto desactivado por error, o que vuelve a venderse, se puede
 * reactivar sin perder su SKU/historial. */
export async function activateProduct(id: number): Promise<Product> {
  return apiFetch(`${API_V1}/products/${id}/activate`, {
    method: 'POST',
    schema: productSchema,
  });
}

export async function addPackage(
  productId: number,
  payload: { name: string; factor: string; barcode: string | null },
): Promise<Product> {
  return apiFetch(`${API_V1}/products/${productId}/packages`, {
    method: 'POST',
    schema: productSchema,
    body: payload,
  });
}

export async function addBarcode(
  productId: number,
  packageId: number,
  barcode: string,
): Promise<Product> {
  return apiFetch(`${API_V1}/products/${productId}/packages/${packageId}/barcodes`, {
    method: 'POST',
    schema: productSchema,
    body: { barcode },
  });
}

/** Un código tecleado mal, o que ha cambiado en la etiqueta del fabricante
 * — se edita en el sitio (mismo id), no se borra y se vuelve a añadir. */
export async function updateBarcode(
  productId: number,
  packageId: number,
  barcodeId: number,
  barcode: string,
): Promise<Product> {
  return apiFetch(`${API_V1}/products/${productId}/packages/${packageId}/barcodes/${barcodeId}`, {
    method: 'PATCH',
    schema: productSchema,
    body: { barcode },
  });
}

export async function deleteBarcode(
  productId: number,
  packageId: number,
  barcodeId: number,
): Promise<Product> {
  return apiFetch(`${API_V1}/products/${productId}/packages/${packageId}/barcodes/${barcodeId}`, {
    method: 'DELETE',
    schema: productSchema,
  });
}
