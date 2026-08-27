import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { productsQuery } from '@/features/catalog/api';
import { useProductSearch } from '@/features/catalog/useProductSearch';
import {
  removeProductSupplier,
  supplierProductsQuery,
  upsertProductSupplier,
  type ProductSupplierInput,
} from '@/features/suppliers/api';
import { decimalString } from '@/lib/decimal';
import { formatMoney } from '@/lib/format';

const linkSchema = z.object({
  product_id: z.string().min(1, 'Elige un producto.'),
  supplier_sku: z.string().max(50).optional(),
  supplier_cost: decimalString({ min: 0 }),
  is_preferred: z.boolean(),
});

type LinkFormValues = z.infer<typeof linkSchema>;

interface SupplierProductsPanelProps {
  supplierId: number;
  canManage: boolean;
}

/** Fila expandida de un proveedor: qué productos vende, con su referencia
 * comercial y coste (independiente de `products.cost`, que es lo último que pagamos
 * nosotros — ver backend/app/suppliers/models.py's `ProductSupplier`). */
export function SupplierProductsPanel({ supplierId, canManage }: SupplierProductsPanelProps) {
  const links = useQuery(supplierProductsQuery(supplierId));
  const products = useQuery(productsQuery({ activeOnly: true }));
  const queryClient = useQueryClient();

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['suppliers', 'products', supplierId] });

  const upsertMutation = useMutation({
    mutationFn: ({ productId, payload }: { productId: number; payload: ProductSupplierInput }) =>
      upsertProductSupplier(productId, supplierId, payload),
    onSuccess: () => {
      invalidate();
      reset({ product_id: '', supplier_sku: '', supplier_cost: '0', is_preferred: false });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (productId: number) => removeProductSupplier(productId, supplierId),
    onSuccess: invalidate,
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<LinkFormValues>({
    resolver: zodResolver(linkSchema),
    defaultValues: { product_id: '', supplier_sku: '', supplier_cost: '0', is_preferred: false },
  });

  const submit = handleSubmit((values) =>
    upsertMutation.mutate({
      productId: Number(values.product_id),
      payload: {
        supplier_sku: values.supplier_sku === '' ? null : (values.supplier_sku ?? null),
        supplier_cost: values.supplier_cost,
        is_preferred: values.is_preferred,
      },
    }),
  );

  const linkedProductIds = new Set(links.data?.map((link) => link.product_id));
  const availableProducts = (products.data ?? []).filter((p) => !linkedProductIds.has(p.id));
  const productFieldId = useId();
  const { query, setQuery, matches } = useProductSearch(availableProducts, {
    onSingleMatch: (id) => setValue('product_id', id),
  });

  return (
    <div className="border-t border-slate-100 bg-slate-50 p-4">
      {links.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {links.isError && (
        <p className="text-sm text-red-600">No se han podido cargar los productos vinculados.</p>
      )}

      {links.data && links.data.length > 0 && (
        <table className="mb-3 w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Producto</th>
              <th className="py-1 pr-3 font-medium">Referencia del proveedor</th>
              <th className="py-1 pr-3 font-medium">Coste</th>
              <th className="py-1 pr-3 font-medium">Preferido</th>
              {canManage && <th className="py-1 pr-3 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {links.data.map((link) => (
              <tr key={link.id} className="border-t border-slate-200">
                <td className="py-1 pr-3">{link.product_name}</td>
                <td className="py-1 pr-3">{link.supplier_sku ?? '—'}</td>
                <td className="py-1 pr-3">{formatMoney(link.supplier_cost)}</td>
                <td className="py-1 pr-3">{link.is_preferred ? 'Sí' : 'No'}</td>
                {canManage && (
                  <td className="py-1 pr-3 text-right">
                    <button
                      type="button"
                      onClick={() => removeMutation.mutate(link.product_id)}
                      disabled={removeMutation.isPending}
                      className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
                    >
                      Quitar
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {links.data && links.data.length === 0 && (
        <p className="mb-3 text-sm text-slate-500">Este proveedor no tiene productos vinculados.</p>
      )}

      {canManage && (
        <form
          onSubmit={(event) => void submit(event)}
          noValidate
          className="flex flex-wrap items-end gap-2"
        >
          <div className="text-sm text-slate-600">
            <label htmlFor={productFieldId}>Producto</label>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nombre o código de barras…"
              aria-label="Buscar producto"
              className="mt-1 block w-48 rounded border border-slate-300 px-3 py-1.5 text-sm"
            />
            <select
              id={productFieldId}
              className="mt-1 block w-48 rounded border border-slate-300 px-3 py-1.5 text-sm"
              {...register('product_id')}
            >
              <option value="">Elige un producto…</option>
              {matches.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
            {errors.product_id && (
              <p className="mt-1 text-sm text-red-600">{errors.product_id.message}</p>
            )}
          </div>

          <label className="text-sm text-slate-600">
            Referencia del proveedor
            <input
              type="text"
              className="mt-1 block w-32 rounded border border-slate-300 px-3 py-1.5 text-sm"
              {...register('supplier_sku')}
            />
          </label>

          <label className="text-sm text-slate-600">
            Coste
            <input
              type="text"
              inputMode="decimal"
              className="mt-1 block w-24 rounded border border-slate-300 px-3 py-1.5 text-sm"
              {...register('supplier_cost')}
            />
            {errors.supplier_cost && (
              <p className="mt-1 text-sm text-red-600">{errors.supplier_cost.message}</p>
            )}
          </label>

          <label className="flex items-center gap-1.5 pb-1.5 text-sm text-slate-600">
            <input type="checkbox" {...register('is_preferred')} />
            Preferido
          </label>

          <button
            type="submit"
            disabled={upsertMutation.isPending}
            className="rounded bg-brand-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {upsertMutation.isPending ? 'Vinculando…' : 'Vincular'}
          </button>
        </form>
      )}
    </div>
  );
}
