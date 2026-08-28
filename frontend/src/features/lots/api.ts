import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// Mirrors backend/app/lots/schemas.py.

export const lotSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  lot_number: z.string(),
  manufacturing_date: z.string().nullable(),
  expiration_date: z.string().nullable(),
  supplier_id: z.number().nullable(),
  purchase_order_id: z.number().nullable(),
});
export type Lot = z.infer<typeof lotSchema>;

export const LOT_PAGE_SIZE = 100;

export interface LotFilters {
  search?: string;
  productId?: number;
  expirationStatus?: 'all' | 'alert' | 'expired' | 'undated';
}

function lotParams(filters: LotFilters, limit: number, offset: number): URLSearchParams {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (filters.search) params.set('search', filters.search);
  if (filters.productId !== undefined) params.set('product_id', String(filters.productId));
  if (filters.expirationStatus && filters.expirationStatus !== 'all') {
    params.set('expiration_status', filters.expirationStatus);
  }
  return params;
}

export function lotsQuery(productId: number | null) {
  const filters = productId === null ? {} : { productId };
  const params = lotParams(filters, LOT_PAGE_SIZE, 0);

  return queryOptions({
    queryKey: ['lots', 'list', productId] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/lots?${params.toString()}`, { schema: z.array(lotSchema), signal }),
  });
}

/** The extra row answers "is there another page?" without adding a count
 * query. Each visible page still contains exactly LOT_PAGE_SIZE rows. */
export function lotsInfiniteQuery(filters: LotFilters) {
  return infiniteQueryOptions({
    queryKey: ['lots', 'list', 'incremental', filters] as const,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      apiFetch(`${API_V1}/lots?${lotParams(filters, LOT_PAGE_SIZE + 1, pageParam).toString()}`, {
        schema: z.array(lotSchema),
        signal,
      }),
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.length > LOT_PAGE_SIZE ? lastPageParam + LOT_PAGE_SIZE : undefined,
  });
}

export interface LotCreateInput {
  product_id: number;
  lot_number: string;
  manufacturing_date: string | null;
  expiration_date: string | null;
  supplier_id: number | null;
  purchase_order_id: number | null;
}

export async function createLot(payload: LotCreateInput): Promise<Lot> {
  return apiFetch(`${API_V1}/lots`, { method: 'POST', schema: lotSchema, body: payload });
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
