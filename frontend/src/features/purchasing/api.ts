import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// Mirrors backend/app/purchasing/schemas.py.

export const purchaseOrderLineSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  product_sku: z.string(),
  product_name: z.string(),
  package_id: z.number(),
  package_name: z.string(),
  package_factor: z.string(),
  quantity_packages: z.string(),
  quantity_ordered: z.string(),
  quantity_received: z.string(),
  unit_cost: z.string(),
  tax_rate: z.string(),
  discount_rate: z.string(),
  subtotal: z.string(),
  discount_amount: z.string(),
  tax_amount: z.string(),
  total: z.string(),
});
export type PurchaseOrderLine = z.infer<typeof purchaseOrderLineSchema>;

export const purchaseOrderSchema = z.object({
  id: z.number(),
  supplier_id: z.number(),
  supplier_name: z.string(),
  status: z.enum(['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']),
  notes: z.string(),
  ordered_at: z.string().nullable(),
  created_at: z.string(),
  lines: z.array(purchaseOrderLineSchema),
  total: z.string(),
});
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;

export interface OrderFilters {
  supplierId?: number;
  status?: string;
}

export function purchaseOrdersQuery(filters: OrderFilters) {
  const params = new URLSearchParams();
  if (filters.supplierId !== undefined) params.set('supplier_id', String(filters.supplierId));
  if (filters.status) params.set('status', filters.status);

  return queryOptions({
    queryKey: ['purchasing', 'orders', filters] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/purchase-orders?${params.toString()}`, {
        schema: z.array(purchaseOrderSchema),
        signal,
      }),
  });
}

export async function createOrder(payload: {
  supplier_id: number;
  notes: string;
}): Promise<PurchaseOrder> {
  return apiFetch(`${API_V1}/purchase-orders`, {
    method: 'POST',
    schema: purchaseOrderSchema,
    body: payload,
  });
}

export interface OrderLineInput {
  product_id: number;
  package_id: number;
  quantity_packages: string;
  unit_cost: string;
  tax_rate: string;
  discount_rate: string;
}

export async function addOrderLine(
  orderId: number,
  payload: OrderLineInput,
): Promise<PurchaseOrder> {
  return apiFetch(`${API_V1}/purchase-orders/${orderId}/lines`, {
    method: 'POST',
    schema: purchaseOrderSchema,
    body: payload,
  });
}

export async function removeOrderLine(orderId: number, lineId: number): Promise<PurchaseOrder> {
  return apiFetch(`${API_V1}/purchase-orders/${orderId}/lines/${lineId}`, {
    method: 'DELETE',
    schema: purchaseOrderSchema,
  });
}

export async function placeOrder(orderId: number, idempotencyKey: string): Promise<PurchaseOrder> {
  return apiFetch(`${API_V1}/purchase-orders/${orderId}/place`, {
    method: 'POST',
    schema: purchaseOrderSchema,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export async function cancelOrder(orderId: number): Promise<PurchaseOrder> {
  return apiFetch(`${API_V1}/purchase-orders/${orderId}/cancel`, {
    method: 'POST',
    schema: purchaseOrderSchema,
  });
}

// --- historial de compras de un producto ------------------------------------

export const productPurchaseHistoryEntrySchema = z.object({
  purchase_order_id: z.number(),
  date: z.string(),
  status: z.string(),
  supplier_id: z.number(),
  supplier_name: z.string(),
  package_name: z.string(),
  quantity_packages: z.string(),
  unit_cost: z.string(),
});
export type ProductPurchaseHistoryEntry = z.infer<typeof productPurchaseHistoryEntrySchema>;

export function productPurchaseHistoryQuery(productId: number) {
  return queryOptions({
    queryKey: ['purchasing', 'product-history', productId] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/products/${productId}/purchase-history`, {
        schema: z.array(productPurchaseHistoryEntrySchema),
        signal,
      }),
  });
}

// --- recepciones de mercancía (fase 9) --------------------------------------

export const goodsReceiptLineSchema = z.object({
  id: z.number(),
  purchase_order_line_id: z.number(),
  product_id: z.number(),
  product_sku: z.string(),
  quantity_packages: z.string(),
  lot_id: z.number().nullable(),
  lot_number: z.string().nullable(),
  stock_movement_id: z.number().nullable(),
});
export type GoodsReceiptLine = z.infer<typeof goodsReceiptLineSchema>;

export const goodsReceiptSchema = z.object({
  id: z.number(),
  purchase_order_id: z.number(),
  warehouse_id: z.number(),
  location_id: z.number(),
  notes: z.string(),
  received_at: z.string(),
  lines: z.array(goodsReceiptLineSchema),
});
export type GoodsReceipt = z.infer<typeof goodsReceiptSchema>;

export function goodsReceiptsQuery(orderId: number) {
  return queryOptions({
    queryKey: ['purchasing', 'receipts', orderId] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/purchase-orders/${orderId}/receipts`, {
        schema: z.array(goodsReceiptSchema),
        signal,
      }),
  });
}

export interface GoodsReceiptLineInput {
  purchase_order_line_id: number;
  quantity_packages: string;
  lot_number: string | null;
  manufacturing_date: string | null;
  expiration_date: string | null;
}

export async function createGoodsReceipt(
  orderId: number,
  payload: {
    warehouse_id: number;
    location_id: number;
    notes: string;
    lines: GoodsReceiptLineInput[];
  },
  idempotencyKey: string,
): Promise<GoodsReceipt> {
  return apiFetch(`${API_V1}/purchase-orders/${orderId}/receipts`, {
    method: 'POST',
    schema: goodsReceiptSchema,
    body: payload,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}
