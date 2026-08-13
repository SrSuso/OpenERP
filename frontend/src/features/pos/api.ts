import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// --- physical/logical terminal identity (A9) -------------------------------

export const posTerminalSchema = z.object({
  id: z.number(),
  name: z.string(),
  warehouse_id: z.number(),
  warehouse_name: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
});
export type PosTerminal = z.infer<typeof posTerminalSchema>;

export function posTerminalsQuery(activeOnly: boolean) {
  return queryOptions({
    queryKey: ['pos', 'terminals', activeOnly] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/pos-terminals?active_only=${activeOnly}`, {
        schema: z.array(posTerminalSchema),
        signal,
      }),
  });
}

export async function createPosTerminal(name: string, warehouseId: number): Promise<PosTerminal> {
  return apiFetch(`${API_V1}/pos-terminals`, {
    method: 'POST',
    schema: posTerminalSchema,
    body: { name, warehouse_id: warehouseId },
  });
}

export async function updatePosTerminal(
  terminalId: number,
  changes: { name?: string; is_active?: boolean },
): Promise<PosTerminal> {
  return apiFetch(`${API_V1}/pos-terminals/${terminalId}`, {
    method: 'PATCH',
    schema: posTerminalSchema,
    body: changes,
  });
}

function terminalHeaders(terminalId: number): Record<string, string> {
  return { 'X-POS-Terminal-ID': String(terminalId) };
}

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
  package_factor: z.string(),
  quantity_packages: z.string(),
  quantity_base: z.string(),
  quantity_refunded: z.string(),
  quantity_physically_returned: z.string(),
  tracks_stock: z.boolean(),
  track_lots: z.boolean(),
  package_price: z.string(),
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
  // El número impreso en el ticket, asignado al cobrar. `null` mientras es
  // un carrito: un carrito que se cancela no gasta número.
  number: z.number().nullable(),
  warehouse_id: z.number(),
  location_id: z.number(),
  terminal_id: z.number().nullable(),
  terminal_name: z.string().nullable(),
  status: z.enum(['DRAFT', 'COMPLETED', 'CANCELLED']),
  notes: z.string(),
  prices_include_tax: z.boolean().nullable().optional(),
  cashier_name: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  // Instante de apertura; los borradores usan éste como día comercial y
  // las ventas cobradas usan completed_at.
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
 * `GET /sales` orders newest-first. The POS resumes that most recently
 * opened cart and keeps every other cart from the same terminal visible in
 * OpenSalesBar; drafts from another terminal never enter this query.
 */
export function draftSalesQuery(terminalId: number | null, warehouseId: number | null) {
  return queryOptions({
    queryKey: ['pos', 'sales', 'draft', terminalId] as const,
    queryFn: ({ signal }) =>
      apiFetch(
        `${API_V1}/sales?status=DRAFT&warehouse_id=${warehouseId}&terminal_id=${terminalId}`,
        {
          schema: z.array(saleSchema),
          signal,
          headers: terminalHeaders(terminalId as number),
        },
      ),
    enabled: warehouseId !== null && terminalId !== null,
  });
}

export interface SalesFilters {
  /** Día concreto, `YYYY-MM-DD`. */
  day?: string;
  status?: 'DRAFT' | 'COMPLETED';
}

/** La venta que lleva ese número impreso, o `null` si no hay ninguna. Es
 * por lo que pregunta un cliente que vuelve con su ticket. */
export function saleByNumberQuery(number: number | null) {
  return queryOptions({
    queryKey: ['sales', 'by-number', number] as const,
    queryFn: async ({ signal }) => {
      const found = await apiFetch(`${API_V1}/sales?number=${number}`, {
        schema: z.array(saleSchema),
        signal,
      });
      return found[0] ?? null;
    },
    enabled: number !== null,
  });
}

/** Las ventas de un día comercial. YYYY-MM-DD llega intacto al backend,
 * que conoce la timezone de la tienda y construye allí [start_utc, end_utc). */
export function salesQuery(filters: SalesFilters) {
  const params = new URLSearchParams({ limit: '500' });
  if (filters.day) params.set('business_date', filters.day);
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

/** Prelectura del producto al que pertenece un código de barras.
 *
 * Sólo decide si el TPV debe pedir un peso antes de vender. La identidad del
 * formato, su factor, precio y cantidad base se vuelven a resolver de forma
 * autoritativa al añadir con `POST .../lines/by-barcode`; React no envía ni
 * reconstruye ninguno de esos valores. */
export async function findProductByBarcode(barcode: string): Promise<Product> {
  return apiFetch(`${API_V1}/products/barcode/${encodeURIComponent(barcode)}`, {
    schema: productSchema,
  });
}

export async function createSale(
  terminalId: number,
  warehouseId: number,
  locationId: number,
): Promise<Sale> {
  return apiFetch(`${API_V1}/sales`, {
    method: 'POST',
    schema: saleSchema,
    body: { warehouse_id: warehouseId, location_id: locationId, terminal_id: terminalId },
  });
}

export async function addLine(
  saleId: number,
  terminalId: number,
  line: { product_id: number; package_id: number; quantity_packages: string },
): Promise<Sale> {
  return apiFetch(`${API_V1}/sales/${saleId}/lines`, {
    method: 'POST',
    schema: saleSchema,
    body: line,
    headers: terminalHeaders(terminalId),
  });
}

export async function addLineByBarcode(
  saleId: number,
  terminalId: number,
  line: { barcode: string; quantity_packages: string },
): Promise<Sale> {
  return apiFetch(`${API_V1}/sales/${saleId}/lines/by-barcode`, {
    method: 'POST',
    schema: saleSchema,
    body: line,
    headers: terminalHeaders(terminalId),
  });
}

export async function removeLine(
  saleId: number,
  lineId: number,
  terminalId: number,
): Promise<Sale> {
  return apiFetch(`${API_V1}/sales/${saleId}/lines/${lineId}`, {
    method: 'DELETE',
    schema: saleSchema,
    headers: terminalHeaders(terminalId),
  });
}

/** Cancelar borra el carrito: no devuelve venta porque ya no la hay. */
export async function cancelSale(saleId: number, terminalId: number): Promise<void> {
  await apiFetch(`${API_V1}/sales/${saleId}/cancel`, {
    method: 'POST',
    schema: z.null(),
    headers: terminalHeaders(terminalId),
  });
}

export interface Tender {
  method: PaymentMethod;
  /** What was tendered — plain decimal string, e.g. `'20.00'`. */
  amount: string;
}

export async function checkout(
  saleId: number,
  payments: Tender[],
  idempotencyKey: string,
  terminalId: number,
): Promise<Sale> {
  return apiFetch(`${API_V1}/sales/${saleId}/checkout`, {
    method: 'POST',
    schema: saleSchema,
    body: { payments },
    headers: { ...terminalHeaders(terminalId), 'Idempotency-Key': idempotencyKey },
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

// --- cierre de caja (la Z de totales) ---------------------------------------

export const zReportSchema = z.object({
  id: z.number(),
  warehouse_id: z.number(),
  number: z.number(),
  covers_from: z.string().nullable(),
  closed_at: z.string(),
  sales_count: z.number(),
  gross_total: z.string(),
  tax_total: z.string(),
  discount_total: z.string(),
  cash_total: z.string(),
  card_total: z.string(),
  other_total: z.string(),
  returns_count: z.number(),
  returns_total: z.string(),
  closed_by_user_id: z.number().nullable(),
});
export type ZReport = z.infer<typeof zReportSchema>;

export const zReportPreviewSchema = zReportSchema
  .omit({ id: true, warehouse_id: true, number: true, closed_at: true, closed_by_user_id: true })
  .extend({
    // Cuáles son, no cuántas: "hay una sin cobrar" sin decir cuál deja sin
    // salida a quien está en el mostrador.
    open_sales: z.array(z.object({ id: z.number(), lines_count: z.number(), total: z.string() })),
  });
export type ZReportPreview = z.infer<typeof zReportPreviewSchema>;

/** Lo que saldría en la Z si se cerrase ahora, sin guardar nada. */
export function zReportPreviewQuery(warehouseId: number | null) {
  return queryOptions({
    queryKey: ['pos', 'z-report', 'preview', warehouseId] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/z-reports/preview?warehouse_id=${warehouseId}`, {
        schema: zReportPreviewSchema,
        signal,
      }),
    enabled: warehouseId !== null,
    // El turno sigue vivo mientras se mira: no vale un total de hace un rato.
    staleTime: 0,
  });
}

/** Cierra el turno y congela sus totales. */
export async function closeZReport(warehouseId: number, idempotencyKey: string): Promise<ZReport> {
  return apiFetch(`${API_V1}/z-reports?warehouse_id=${warehouseId}`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    schema: zReportSchema,
  });
}
