import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// Mirrors backend/app/suppliers/schemas.py's SupplierRead.
export const supplierSchema = z.object({
  id: z.number(),
  name: z.string(),
  tax_id: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string(),
  is_active: z.boolean(),
});
export type Supplier = z.infer<typeof supplierSchema>;

export function suppliersQuery(activeOnly: boolean) {
  return queryOptions({
    queryKey: ['suppliers', 'list', activeOnly] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/suppliers?active_only=${activeOnly}`, {
        schema: z.array(supplierSchema),
        signal,
      }),
  });
}

export interface SupplierCreateInput {
  name: string;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  address: string;
}

export async function createSupplier(payload: SupplierCreateInput): Promise<Supplier> {
  return apiFetch(`${API_V1}/suppliers`, { method: 'POST', schema: supplierSchema, body: payload });
}

export type SupplierUpdateInput = Partial<SupplierCreateInput>;

export async function updateSupplier(id: number, payload: SupplierUpdateInput): Promise<Supplier> {
  return apiFetch(`${API_V1}/suppliers/${id}`, {
    method: 'PATCH',
    schema: supplierSchema,
    body: payload,
  });
}

export async function deactivateSupplier(id: number): Promise<Supplier> {
  return apiFetch(`${API_V1}/suppliers/${id}/deactivate`, {
    method: 'POST',
    schema: supplierSchema,
  });
}

export async function activateSupplier(id: number): Promise<Supplier> {
  return apiFetch(`${API_V1}/suppliers/${id}/activate`, {
    method: 'POST',
    schema: supplierSchema,
  });
}

// --- productos vendidos por un proveedor: su SKU y coste (independiente
// del coste propio del producto, que es lo último que pagamos nosotros) ---

// Mirrors backend/app/suppliers/schemas.py's ProductSupplierRead.
export const productSupplierSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  product_sku: z.string(),
  product_name: z.string(),
  supplier_id: z.number(),
  supplier_name: z.string(),
  supplier_sku: z.string().nullable(),
  supplier_cost: z.string(),
  is_preferred: z.boolean(),
});
export type ProductSupplier = z.infer<typeof productSupplierSchema>;

export function supplierProductsQuery(supplierId: number) {
  return queryOptions({
    queryKey: ['suppliers', 'products', supplierId] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/suppliers/${supplierId}/products`, {
        schema: z.array(productSupplierSchema),
        signal,
      }),
  });
}

export interface ProductSupplierInput {
  supplier_sku: string | null;
  supplier_cost: string;
  is_preferred: boolean;
}

export async function upsertProductSupplier(
  productId: number,
  supplierId: number,
  payload: ProductSupplierInput,
): Promise<ProductSupplier> {
  return apiFetch(`${API_V1}/products/${productId}/suppliers/${supplierId}`, {
    method: 'PUT',
    schema: productSupplierSchema,
    body: payload,
  });
}

export async function removeProductSupplier(productId: number, supplierId: number): Promise<void> {
  await apiFetch(`${API_V1}/products/${productId}/suppliers/${supplierId}`, {
    method: 'DELETE',
    schema: z.null(),
  });
}
