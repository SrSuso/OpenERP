import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  productSuppliersQuery,
  removeProductSupplier,
  upsertProductSupplier,
  type ProductSupplierInput,
  type Supplier,
} from '@/features/suppliers/api';
import { decimalString } from '@/lib/decimal';
import { formatMoney } from '@/lib/format';

const linkSchema = z.object({
  supplier_id: z.string().min(1, 'Elige un proveedor.'),
  supplier_sku: z.string().max(50).optional(),
  supplier_cost: decimalString({ min: 0 }),
  is_preferred: z.boolean(),
});

type LinkFormValues = z.infer<typeof linkSchema>;

interface ProductSuppliersPanelProps {
  productId: number;
  suppliers: Supplier[];
  canManage: boolean;
}

/** Pestaña "Proveedores" de la ficha de producto — el mismo vínculo que
 * gestiona `features/suppliers/SupplierProductsPanel` desde el lado del
 * proveedor, aquí visto desde el producto: qué proveedores lo venden, con
 * su propio SKU y coste (independiente de `products.cost`). */
export function ProductSuppliersPanel({
  productId,
  suppliers,
  canManage,
}: ProductSuppliersPanelProps) {
  const links = useQuery(productSuppliersQuery(productId));
  const queryClient = useQueryClient();

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['suppliers', 'by-product', productId] });

  const upsertMutation = useMutation({
    mutationFn: ({ supplierId, payload }: { supplierId: number; payload: ProductSupplierInput }) =>
      upsertProductSupplier(productId, supplierId, payload),
    onSuccess: () => {
      invalidate();
      reset({ supplier_id: '', supplier_sku: '', supplier_cost: '0', is_preferred: false });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (supplierId: number) => removeProductSupplier(productId, supplierId),
    onSuccess: invalidate,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<LinkFormValues>({
    resolver: zodResolver(linkSchema),
    defaultValues: { supplier_id: '', supplier_sku: '', supplier_cost: '0', is_preferred: false },
  });

  const submit = handleSubmit((values) =>
    upsertMutation.mutate({
      supplierId: Number(values.supplier_id),
      payload: {
        supplier_sku: values.supplier_sku === '' ? null : (values.supplier_sku ?? null),
        supplier_cost: values.supplier_cost,
        is_preferred: values.is_preferred,
      },
    }),
  );

  const linkedSupplierIds = new Set(links.data?.map((link) => link.supplier_id));
  const availableSuppliers = suppliers.filter((s) => !linkedSupplierIds.has(s.id));

  return (
    <div>
      {links.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {links.isError && (
        <p className="text-sm text-red-600">No se han podido cargar los proveedores.</p>
      )}

      {links.data && links.data.length > 0 && (
        <table className="mb-4 w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Proveedor</th>
              <th className="py-1 pr-3 font-medium">SKU proveedor</th>
              <th className="py-1 pr-3 font-medium">Coste</th>
              <th className="py-1 pr-3 font-medium">Preferido</th>
              {canManage && <th className="py-1 pr-3 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {links.data.map((link) => (
              <tr key={link.id} className="border-t border-slate-200">
                <td className="py-1 pr-3">{link.supplier_name}</td>
                <td className="py-1 pr-3">{link.supplier_sku ?? '—'}</td>
                <td className="py-1 pr-3">{formatMoney(link.supplier_cost)}</td>
                <td className="py-1 pr-3">{link.is_preferred ? 'Sí' : 'No'}</td>
                {canManage && (
                  <td className="py-1 pr-3 text-right">
                    <button
                      type="button"
                      onClick={() => removeMutation.mutate(link.supplier_id)}
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
        <p className="mb-4 text-sm text-slate-500">
          Este producto no tiene proveedores vinculados.
        </p>
      )}

      {canManage && (
        <form
          onSubmit={(event) => void submit(event)}
          noValidate
          className="flex flex-wrap items-end gap-2"
        >
          <label className="text-sm text-slate-600">
            Proveedor
            <select
              className="mt-1 block w-48 rounded border border-slate-300 px-3 py-1.5 text-sm"
              {...register('supplier_id')}
            >
              <option value="">Elige un proveedor…</option>
              {availableSuppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
            {errors.supplier_id && (
              <p className="mt-1 text-sm text-red-600">{errors.supplier_id.message}</p>
            )}
          </label>

          <label className="text-sm text-slate-600">
            SKU del proveedor
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
