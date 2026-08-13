import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// Mirrors backend/app/sales/schemas.py's SaleLineRead/SaleRead — only the
// fields a return needs to pick a line and know what is still pending.
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
  unit_price: z.string(),
  total: z.string(),
});
export type SaleLine = z.infer<typeof saleLineSchema>;

export const saleSchema = z.object({
  id: z.number(),
  status: z.string(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  lines: z.array(saleLineSchema),
  total: z.string(),
});
export type Sale = z.infer<typeof saleSchema>;

export function saleQuery(saleId: number) {
  return queryOptions({
    queryKey: ['returns', 'sale', saleId] as const,
    queryFn: ({ signal }) => apiFetch(`${API_V1}/sales/${saleId}`, { schema: saleSchema, signal }),
  });
}

// Mirrors backend/app/returns/schemas.py.

export const returnLineSchema = z.object({
  id: z.number(),
  sale_line_id: z.number(),
  product_id: z.number(),
  product_sku: z.string(),
  product_name: z.string(),
  package_id: z.number(),
  package_name: z.string(),
  refund_quantity_packages: z.string(),
  refund_quantity_base: z.string(),
  stock_return_quantity_packages: z.string(),
  stock_return_quantity_base: z.string(),
  refund_amount: z.string(),
  lot_id: z.number().nullable(),
  lot_number: z.string().nullable(),
  stock_movement_id: z.number().nullable(),
});
export type ReturnLine = z.infer<typeof returnLineSchema>;

export const refundSchema = z.object({
  id: z.number(),
  return_id: z.number(),
  amount: z.string(),
  method: z.enum(['CASH', 'CARD', 'OTHER']).nullable(),
  status: z.literal('COMPLETED'),
  processed_by_user_id: z.number().nullable(),
  created_at: z.string(),
  completed_at: z.string(),
});

export const returnSchema = z.object({
  id: z.number(),
  sale_id: z.number(),
  notes: z.string(),
  processed_by_user_id: z.number().nullable(),
  created_at: z.string(),
  lines: z.array(returnLineSchema),
  refund: refundSchema.nullable(),
  total_refund: z.string(),
});
export type Return = z.infer<typeof returnSchema>;

export function saleReturnsQuery(saleId: number) {
  return queryOptions({
    queryKey: ['returns', 'by-sale', saleId] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/sales/${saleId}/returns`, { schema: z.array(returnSchema), signal }),
  });
}

export interface ReturnLineInput {
  sale_line_id: number;
  refund_quantity_packages: string;
  stock_return_quantity_packages: string;
  lot_number: string | null;
}

export type RefundMethod = 'CASH' | 'CARD' | 'OTHER';

export interface ReturnInput {
  notes: string;
  lines: ReturnLineInput[];
  refund_method?: RefundMethod;
}

export async function createReturn(
  saleId: number,
  payload: ReturnInput,
  idempotencyKey: string,
): Promise<Return> {
  return apiFetch(`${API_V1}/sales/${saleId}/returns`, {
    method: 'POST',
    schema: returnSchema,
    body: payload,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}
