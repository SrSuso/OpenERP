import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// --- almacenes y ubicaciones -----------------------------------------------

export const warehouseSchema = z.object({
  id: z.number(),
  name: z.string(),
  is_active: z.boolean(),
});
export type Warehouse = z.infer<typeof warehouseSchema>;

export const warehousesQuery = queryOptions({
  queryKey: ['inventory', 'warehouses'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/warehouses`, { schema: z.array(warehouseSchema), signal }),
});

export async function createWarehouse(name: string): Promise<Warehouse> {
  return apiFetch(`${API_V1}/warehouses`, {
    method: 'POST',
    schema: warehouseSchema,
    body: { name },
  });
}

export const locationSchema = z.object({
  id: z.number(),
  warehouse_id: z.number(),
  name: z.string(),
  is_active: z.boolean(),
});
export type Location = z.infer<typeof locationSchema>;

export function locationsQuery(warehouseId: number | null) {
  return queryOptions({
    queryKey: ['inventory', 'locations', warehouseId] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/warehouses/${warehouseId}/locations`, {
        schema: z.array(locationSchema),
        signal,
      }),
    enabled: warehouseId !== null,
  });
}

export async function createLocation(warehouseId: number, name: string): Promise<Location> {
  return apiFetch(`${API_V1}/warehouses/${warehouseId}/locations`, {
    method: 'POST',
    schema: locationSchema,
    body: { name },
  });
}

// --- movimientos y saldos de stock ------------------------------------------

export const stockMovementSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  product_sku: z.string(),
  warehouse_id: z.number(),
  location_id: z.number(),
  lot_id: z.number().nullable(),
  quantity: z.string(),
  movement_type: z.string(),
  reference_type: z.string().nullable(),
  reference_id: z.number().nullable(),
  unit_cost: z.string(),
  user_id: z.number().nullable(),
  created_at: z.string(),
});
export type StockMovement = z.infer<typeof stockMovementSchema>;

export interface MovementFilters {
  productId?: number;
  warehouseId?: number;
  locationId?: number;
}

export function stockMovementsQuery(filters: MovementFilters) {
  const params = new URLSearchParams();
  if (filters.productId !== undefined) params.set('product_id', String(filters.productId));
  if (filters.warehouseId !== undefined) params.set('warehouse_id', String(filters.warehouseId));
  if (filters.locationId !== undefined) params.set('location_id', String(filters.locationId));

  return queryOptions({
    queryKey: ['inventory', 'movements', filters] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/stock-movements?${params.toString()}`, {
        schema: z.array(stockMovementSchema),
        signal,
      }),
  });
}

export const stockBalanceSchema = z.object({
  product_id: z.number(),
  product_sku: z.string(),
  warehouse_id: z.number(),
  location_id: z.number(),
  lot_id: z.number().nullable(),
  quantity: z.string(),
});
export type StockBalance = z.infer<typeof stockBalanceSchema>;

export interface BalanceFilters {
  productId?: number;
  warehouseId?: number;
}

export function stockBalanceQuery(filters: BalanceFilters) {
  const params = new URLSearchParams();
  if (filters.productId !== undefined) params.set('product_id', String(filters.productId));
  if (filters.warehouseId !== undefined) params.set('warehouse_id', String(filters.warehouseId));

  return queryOptions({
    queryKey: ['inventory', 'balances', filters] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/stock-balance?${params.toString()}`, {
        schema: z.array(stockBalanceSchema),
        signal,
      }),
  });
}

export interface AdjustmentInput {
  product_id: number;
  warehouse_id: number;
  location_id: number;
  movement_type: 'ADJUSTMENT' | 'WASTE';
  quantity: string;
  unit_cost: string;
  lot_id: number | null;
  reason: string;
}

export async function recordAdjustment(payload: AdjustmentInput): Promise<StockMovement> {
  return apiFetch(`${API_V1}/stock-movements/adjustments`, {
    method: 'POST',
    schema: stockMovementSchema,
    body: payload,
  });
}

export interface TransferInput {
  product_id: number;
  from_warehouse_id: number;
  from_location_id: number;
  to_warehouse_id: number;
  to_location_id: number;
  quantity: string;
  unit_cost: string;
  lot_id: number | null;
}

export const transferResultSchema = z.object({
  out_movement: stockMovementSchema,
  in_movement: stockMovementSchema,
});
export type TransferResult = z.infer<typeof transferResultSchema>;

export async function recordTransfer(payload: TransferInput): Promise<TransferResult> {
  return apiFetch(`${API_V1}/stock-movements/transfers`, {
    method: 'POST',
    schema: transferResultSchema,
    body: payload,
  });
}

// --- reconstruir stock_balance desde el histórico de movimientos ----------

const rebuildResultSchema = z.object({ rows: z.number() });

/** Borra y recalcula `stock_balance` desde cero sumando `stock_movements`
 * (backend/app/inventory/service.py's `rebuild_stock_balance`) — la
 * proyección siempre tiene que poder reconstruirse íntegra desde el
 * histórico (regla 2); esto es el botón de "algo no cuadra, recalcúlalo"
 * para cuando hiciera falta, no algo que se llame en el día a día. */
export async function rebuildStockBalance(): Promise<number> {
  const result = await apiFetch(`${API_V1}/stock-balance/rebuild`, {
    method: 'POST',
    schema: rebuildResultSchema,
  });
  return result.rows;
}
