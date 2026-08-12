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
  quantity_returned: z.string(),
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
  quantity_packages: z.string(),
  quantity_base: z.string(),
  is_economic: z.boolean(),
  is_physical: z.boolean(),
  refund_amount: z.string(),
  lot_id: z.number().nullable(),
  lot_number: z.string().nullable(),
  stock_movement_id: z.number().nullable(),
});
export type ReturnLine = z.infer<typeof returnLineSchema>;

export const returnSchema = z.object({
  id: z.number(),
  sale_id: z.number(),
  notes: z.string(),
  processed_by_user_id: z.number().nullable(),
  created_at: z.string(),
  lines: z.array(returnLineSchema),
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
  quantity_packages: string;
  economic: boolean;
  physical: boolean;
  lot_number: string | null;
}

export async function createReturn(
  saleId: number,
  payload: { notes: string; lines: ReturnLineInput[] },
  idempotencyKey: string,
): Promise<Return> {
  return apiFetch(`${API_V1}/sales/${saleId}/returns`, {
    method: 'POST',
    schema: returnSchema,
    body: payload,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}
