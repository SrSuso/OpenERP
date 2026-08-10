import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import {
  type Product,
  type ProductCategory,
  productSchema,
  productCategorySchema,
} from '@/features/catalog/api';
import { API_V1, apiFetch } from '@/lib/api';

// --- impuestos (el catálogo real — nombre + tasa; ver también
// features/catalog's ProductTax, la vista reducida que ve un producto) ----

export const taxSchema = z.object({
  id: z.number(),
  name: z.string(),
  rate: z.string(),
  is_active: z.boolean(),
});
export type Tax = z.infer<typeof taxSchema>;

export const taxesQuery = queryOptions({
  queryKey: ['pricing', 'taxes'] as const,
  queryFn: ({ signal }) => apiFetch(`${API_V1}/taxes`, { schema: z.array(taxSchema), signal }),
});

export async function createTax(name: string, rate: string): Promise<Tax> {
  return apiFetch(`${API_V1}/taxes`, {
    method: 'POST',
    schema: taxSchema,
    body: { name, rate },
  });
}

export async function updateTax(id: number, input: { name?: string; rate?: string }): Promise<Tax> {
  return apiFetch(`${API_V1}/taxes/${id}`, {
    method: 'PATCH',
    schema: taxSchema,
    body: input,
  });
}

// --- fórmula del PVP, configurable, un único valor para toda la tienda ----

export const pricingSettingsSchema = z.object({ formula: z.string() });
export type PricingSettings = z.infer<typeof pricingSettingsSchema>;

export const pricingSettingsQuery = queryOptions({
  queryKey: ['pricing', 'settings'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/pricing/settings`, { schema: pricingSettingsSchema, signal }),
});

export async function updatePricingSettings(formula: string): Promise<PricingSettings> {
  return apiFetch(`${API_V1}/pricing/settings`, {
    method: 'PUT',
    schema: pricingSettingsSchema,
    body: { formula },
  });
}

export interface FormulaPreviewInput {
  formula: string;
  cost: string;
  tax_rate: string;
  surcharge_rate: string;
  margin_rate: string;
}

const formulaPreviewResponseSchema = z.object({ result: z.string() });

/** Nunca toca un producto real — para el "PVP en vivo" del formulario de
 * alta y del editor de fórmula. */
export async function previewFormula(input: FormulaPreviewInput): Promise<string> {
  const { result } = await apiFetch(`${API_V1}/pricing/preview`, {
    method: 'POST',
    schema: formulaPreviewResponseSchema,
    body: input,
  });
  return result;
}

// --- margen/impuestos explícitos de un producto o una categoría -----------

export interface PricingOverrideInput {
  /** `undefined` = no tocar; `null` = quitar el propio y heredar de la
   * categoría; un valor = fijarlo explícitamente. */
  margin_rate?: string | null;
  /** `undefined` = no tocar; `[]` = quitar los propios y heredar de la
   * categoría; una lista = fijarla explícitamente. */
  tax_ids?: number[];
}

export async function setProductPricing(
  productId: number,
  input: PricingOverrideInput & { cost?: string },
): Promise<Product> {
  return apiFetch(`${API_V1}/products/${productId}/pricing`, {
    method: 'PATCH',
    schema: productSchema,
    body: input,
  });
}

export async function setCategoryPricing(
  categoryId: number,
  input: PricingOverrideInput,
): Promise<ProductCategory> {
  return apiFetch(`${API_V1}/product-categories/${categoryId}/pricing`, {
    method: 'PATCH',
    schema: productCategorySchema,
    body: input,
  });
}

// --- fórmula propia de un producto, precio manual, e histórico ------------

/** Fija una fórmula que sólo aplica a este producto (pisa la de la tienda
 * mientras esté puesta) — recalcula `list_price` al momento. */
export async function setProductFormula(productId: number, priceFormula: string): Promise<Product> {
  return apiFetch(`${API_V1}/products/${productId}/pricing/formula`, {
    method: 'PUT',
    schema: productSchema,
    body: { price_formula: priceFormula },
  });
}

/** Quita la fórmula propia — vuelve a heredar la de la tienda en el
 * siguiente recálculo (un cambio de coste/margen/impuestos, o de la propia
 * fórmula de la tienda). El PVP actual no cambia por sí solo al limpiarla. */
export async function clearProductFormula(productId: number): Promise<Product> {
  return apiFetch(`${API_V1}/products/${productId}/pricing/formula`, {
    method: 'DELETE',
    schema: productSchema,
  });
}

/** Fija un precio fijo, saltándose la fórmula — y quita la fórmula propia
 * si el producto tenía una (backend: app.pricing.service.set_manual_price),
 * para que un cambio posterior de coste/margen no la recalcule por
 * sorpresa. */
export async function setManualPrice(productId: number, listPrice: string): Promise<Product> {
  return apiFetch(`${API_V1}/products/${productId}/pricing/manual-price`, {
    method: 'PUT',
    schema: productSchema,
    body: { list_price: listPrice },
  });
}

export const priceHistoryEntrySchema = z.object({
  id: z.number(),
  product_id: z.number(),
  cost: z.string(),
  tax_rate: z.string(),
  surcharge_rate: z.string(),
  margin_rate: z.string(),
  price_formula: z.string().nullable(),
  list_price: z.string(),
  created_at: z.string(),
});
export type PriceHistoryEntry = z.infer<typeof priceHistoryEntrySchema>;

export function productPriceHistoryQuery(productId: number) {
  return queryOptions({
    queryKey: ['pricing', 'history', productId] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/products/${productId}/pricing/history`, {
        schema: z.array(priceHistoryEntrySchema),
        signal,
      }),
  });
}
