import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// Mirrors backend/app/lots/schemas.py.

export const lotSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  product_sku: z.string(),
  lot_number: z.string(),
  manufacturing_date: z.string().nullable(),
  expiration_date: z.string().nullable(),
  supplier_id: z.number().nullable(),
  purchase_order_id: z.number().nullable(),
});
export type Lot = z.infer<typeof lotSchema>;

export function lotsQuery(productId: number | null) {
  const params = new URLSearchParams();
  if (productId !== null) params.set('product_id', String(productId));

  return queryOptions({
    queryKey: ['lots', 'list', productId] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/lots?${params.toString()}`, { schema: z.array(lotSchema), signal }),
  });
}

export interface LotCreateInput {
  product_id: number;
  lot_number: string;
  manufacturing_date: string | null;
  expiration_date: string | null;
  supplier_id: number | null;
  purchase_order_id: number | null;
  opening_stock?: {
    warehouse_id: number;
    location_id: number;
    quantity: string;
  } | null;
}

export interface LotUpdateInput {
  lot_number: string;
  manufacturing_date: string | null;
  expiration_date: string | null;
  supplier_id: number | null;
}

export async function createLot(payload: LotCreateInput): Promise<Lot> {
  return apiFetch(`${API_V1}/lots`, { method: 'POST', schema: lotSchema, body: payload });
}

export async function updateLot(lotId: number, payload: LotUpdateInput): Promise<Lot> {
  return apiFetch(`${API_V1}/lots/${lotId}`, { method: 'PUT', schema: lotSchema, body: payload });
}

export async function deleteLot(lotId: number): Promise<void> {
  await apiFetch(`${API_V1}/lots/${lotId}`, { method: 'DELETE', schema: z.null() });
}

// --- saldo por lote (FEFO: primero el que antes caduca) --------------------

export const lotBalanceSchema = z.object({
  lot: lotSchema,
  quantity: z.string(),
});
export type LotBalance = z.infer<typeof lotBalanceSchema>;

export function lotBalancesQuery(productId: number, warehouseId: number, locationId: number) {
  return queryOptions({
    queryKey: ['lots', 'balances', productId, warehouseId, locationId] as const,
    queryFn: ({ signal }) =>
      apiFetch(
        `${API_V1}/products/${productId}/lot-balances?warehouse_id=${warehouseId}&location_id=${locationId}`,
        { schema: z.array(lotBalanceSchema), signal },
      ),
  });
}

const fefoAllocationSchema = z.object({
  lot_id: z.number(),
  lot_number: z.string(),
  expiration_date: z.string().nullable(),
  quantity: z.string(),
});
export type FefoAllocation = z.infer<typeof fefoAllocationSchema>;

export async function planFefo(
  productId: number,
  payload: { warehouse_id: number; location_id: number; quantity: string },
): Promise<FefoAllocation[]> {
  const result = await apiFetch(`${API_V1}/products/${productId}/fefo-plan`, {
    method: 'POST',
    schema: z.object({ allocations: z.array(fefoAllocationSchema) }),
    body: payload,
  });
  return result.allocations;
}

export interface FefoConsumeInput {
  warehouse_id: number;
  location_id: number;
  quantity: string;
  movement_type: 'ADJUSTMENT' | 'WASTE';
  unit_cost: string;
  reason: string;
}

export async function consumeFefo(
  productId: number,
  payload: FefoConsumeInput,
  idempotencyKey: string,
): Promise<FefoAllocation[]> {
  const result = await apiFetch(`${API_V1}/products/${productId}/fefo-consume`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    schema: z.object({
      allocations: z.array(fefoAllocationSchema),
      movement_ids: z.array(z.number()),
    }),
    body: payload,
  });
  return result.allocations;
}
