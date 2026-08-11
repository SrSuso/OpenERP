import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// --- warehouses / locations (phase 7) — the till needs to know where it sells from ---

export const warehouseSchema = z.object({
  id: z.number(),
  name: z.string(),
  is_active: z.boolean(),
});
export type Warehouse = z.infer<typeof warehouseSchema>;

export const locationSchema = z.object({
  id: z.number(),
  warehouse_id: z.number(),
  name: z.string(),
  is_active: z.boolean(),
});
export type Location = z.infer<typeof locationSchema>;

export const warehousesQuery = queryOptions({
  queryKey: ['pos', 'warehouses'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/warehouses`, { schema: z.array(warehouseSchema), signal }),
});

export function locationsQuery(warehouseId: number) {
  return queryOptions({
    queryKey: ['pos', 'warehouses', warehouseId, 'locations'] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/warehouses/${warehouseId}/locations`, {
        schema: z.array(locationSchema),
        signal,
      }),
    enabled: Number.isFinite(warehouseId),
  });
}

// --- POS categories (phase 10) --------------------------------------------------

export const posCategorySchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
  display_order: z.number(),
  is_active: z.boolean(),
});
export type PosCategory = z.infer<typeof posCategorySchema>;

export const posCategoriesQuery = queryOptions({
  queryKey: ['pos', 'categories'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/pos-categories`, { schema: z.array(posCategorySchema), signal }),
});

// --- products (phase 3/10) -------------------------------------------------------

export const packageSchema = z.object({
  id: z.number(),
  name: z.string(),
  factor: z.string(),
  is_base: z.boolean(),
  barcodes: z.array(z.object({ id: z.number(), barcode: z.string() })),
});

export const productSchema = z.object({
  id: z.number(),
  sku: z.string(),
  name: z.string(),
  pos_category_id: z.number().nullable(),
  pos_category_name: z.string().nullable(),
  // En qué se vende: lo que decide si un toque vende una unidad o hay que
  // preguntar cuánto pesa (ver el ajuste `pos.weighed_units`).
  base_unit_name: z.string(),
  list_price: z.string(),
  tax_rate: z.string(),
  is_active: z.boolean(),
  packages: z.array(packageSchema),
});
export type Product = z.infer<typeof productSchema>;

/** The base (`factor == 1`) package every product always has — what a plain
 * tap on its button sells. */
export function basePackage(product: Product) {
  const base = product.packages.find((p) => p.is_base);
  if (!base) {
    throw new Error(`Product ${product.sku} has no base package.`);
  }
  return base;
}

export function productsQuery(filters: { posCategoryId?: number; search?: string }) {
  const params = new URLSearchParams({ active_only: 'true' });
  if (filters.posCategoryId !== undefined) {
    params.set('pos_category_id', String(filters.posCategoryId));
  }
  if (filters.search) {
    params.set('search', filters.search);
  }
  return queryOptions({
    queryKey: ['pos', 'products', filters.posCategoryId ?? null, filters.search ?? ''] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/products?${params.toString()}`, {
        schema: z.array(productSchema),
        signal,
      }),
  });
}

// --- sales (phase 11: cart · phase 13: checkout/payment) -------------------------

export const paymentMethodSchema = z.enum(['CASH', 'CARD', 'OTHER']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const paymentSchema = z.object({
  id: z.number(),
  method: paymentMethodSchema,
  amount: z.string(),
  created_at: z.string(),
});
export type Payment = z.infer<typeof paymentSchema>;

export const saleLineSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  product_sku: z.string(),
  product_name: z.string(),
  package_id: z.number(),
  package_name: z.string(),
  quantity_packages: z.string(),
  quantity_base: z.string(),
  quantity_returned: z.string(),
  unit_price: z.string(),
  tax_rate: z.string(),
  discount_rate: z.string(),
  subtotal: z.string(),
  discount_amount: z.string(),
  tax_amount: z.string(),
  total: z.string(),
});
export type SaleLine = z.infer<typeof saleLineSchema>;

export const saleSchema = z.object({
  id: z.number(),
  warehouse_id: z.number(),
  location_id: z.number(),
  status: z.enum(['DRAFT', 'COMPLETED', 'CANCELLED']),
  notes: z.string(),
  // Cuándo se abrió: es por lo que se listan y se filtran en la pantalla
  // de Ventas, y lo único que tienen también las que se quedaron sin
  // cobrar.
  created_at: z.string(),
  lines: z.array(saleLineSchema),
  total: z.string(),
  payments: z.array(paymentSchema),
  change_due: z.string(),
});
export type Sale = z.infer<typeof saleSchema>;

export function saleQuery(saleId: number | null) {
  return queryOptions({
    queryKey: ['pos', 'sales', saleId] as const,
    queryFn: ({ signal }) => apiFetch(`${API_V1}/sales/${saleId}`, { schema: saleSchema, signal }),
    enabled: saleId !== null,
  });
}

/**
 * The till's own open cart, if the cashier already had one going (a page
 * reload must not orphan an in-progress sale and silently start a new one).
 * `GET /sales` orders by `created_at desc`, so the first `DRAFT` result for
 * this warehouse is the one to resume.
 */
export function draftSalesQuery(warehouseId: number | null) {
  return queryOptions({
    queryKey: ['pos', 'sales', 'draft', warehouseId] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/sales?status=DRAFT&warehouse_id=${warehouseId}`, {
        schema: z.array(saleSchema),
        signal,
      }),
    enabled: warehouseId !== null,
  });
}

export interface SalesFilters {
  /** Día concreto, `YYYY-MM-DD`. */
  day?: string;
  status?: 'DRAFT' | 'COMPLETED' | 'CANCELLED';
}

/** Las ventas de un día, para la pantalla de Ventas del panel. El rango va
 * de ese día al siguiente porque el servidor lo trata cerrado por abajo y
 * abierto por arriba: así entra el día entero sin pelearse con la última
 * hora. */
export function salesQuery(filters: SalesFilters) {
  const params = new URLSearchParams({ limit: '500' });
  if (filters.day) {
    const next = new Date(`${filters.day}T00:00:00`);
    next.setDate(next.getDate() + 1);
    params.set('created_from', filters.day);
    params.set('created_to', next.toISOString().slice(0, 10));
  }
  if (filters.status) params.set('status', filters.status);

  return queryOptions({
    queryKey: ['sales', 'list', filters] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/sales?${params.toString()}`, {
        schema: z.array(saleSchema),
        signal,
      }),
  });
}

export async function createSale(warehouseId: number, locationId: number): Promise<Sale> {
  return apiFetch(`${API_V1}/sales`, {
    method: 'POST',
    schema: saleSchema,
    body: { warehouse_id: warehouseId, location_id: locationId },
  });
}

export async function addLine(
  saleId: number,
  line: { product_id: number; package_id: number; quantity_packages: string },
): Promise<Sale> {
  return apiFetch(`${API_V1}/sales/${saleId}/lines`, {
    method: 'POST',
    schema: saleSchema,
    body: line,
  });
}

export async function addLineByBarcode(saleId: number, barcode: string): Promise<Sale> {
  return apiFetch(`${API_V1}/sales/${saleId}/lines/by-barcode`, {
    method: 'POST',
    schema: saleSchema,
    body: { barcode },
  });
}

export async function removeLine(saleId: number, lineId: number): Promise<Sale> {
  return apiFetch(`${API_V1}/sales/${saleId}/lines/${lineId}`, {
    method: 'DELETE',
    schema: saleSchema,
  });
}

export async function cancelSale(saleId: number): Promise<Sale> {
  return apiFetch(`${API_V1}/sales/${saleId}/cancel`, { method: 'POST', schema: saleSchema });
}

export interface Tender {
  method: PaymentMethod;
  /** What was tendered — plain decimal string, e.g. `'20.00'`. */
  amount: string;
}

export async function checkout(saleId: number, payments: Tender[]): Promise<Sale> {
  return apiFetch(`${API_V1}/sales/${saleId}/checkout`, {
    method: 'POST',
    schema: saleSchema,
    body: { payments },
  });
}

// --- tickets (phase 15) -----------------------------------------------------

export const ticketSchema = z.object({
  id: z.number(),
  sale_id: z.number(),
  template_id: z.number(),
  width_mm: z.number(),
  rendered_text: z.string(),
  created_at: z.string(),
});
export type Ticket = z.infer<typeof ticketSchema>;

/** Idempotent: the first call generates and freezes the sale's one and
 * only ticket; every later call (a reprint) just returns that same text. */
export async function generateTicket(saleId: number): Promise<Ticket> {
  return apiFetch(`${API_V1}/sales/${saleId}/tickets`, {
    method: 'POST',
    schema: ticketSchema,
  });
}
