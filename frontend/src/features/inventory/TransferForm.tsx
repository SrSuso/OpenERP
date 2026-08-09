import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { type Product } from '@/features/catalog/api';
import { locationsQuery, warehousesQuery } from '@/features/inventory/api';
import { decimalString } from '@/lib/decimal';

const transferSchema = z.object({
  product_id: z.string().min(1, 'Elige un producto.'),
  from_warehouse_id: z.string().min(1, 'Elige un almacén de origen.'),
  from_location_id: z.string().min(1, 'Elige una ubicación de origen.'),
  to_warehouse_id: z.string().min(1, 'Elige un almacén de destino.'),
  to_location_id: z.string().min(1, 'Elige una ubicación de destino.'),
  quantity: decimalString({ min: 0.000001 }),
  unit_cost: decimalString({ min: 0 }),
  lot_id: z.string().optional(),
});

type TransferFormValues = z.infer<typeof transferSchema>;

interface TransferFormProps {
  products: Product[];
  onSubmit: (payload: {
    product_id: number;
    from_warehouse_id: number;
    from_location_id: number;
    to_warehouse_id: number;
    to_location_id: number;
    quantity: string;
    unit_cost: string;
    lot_id: number | null;
  }) => void;
  isPending: boolean;
  submitError: string | null;
}

export function TransferForm({ products, onSubmit, isPending, submitError }: TransferFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<TransferFormValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: { unit_cost: '0' },
  });

  const fromWarehouseId = watch('from_warehouse_id');
  const toWarehouseId = watch('to_warehouse_id');
  const warehouses = useQuery(warehousesQuery);
  const fromLocations = useQuery(locationsQuery(fromWarehouseId ? Number(fromWarehouseId) : null));
  const toLocations = useQuery(locationsQuery(toWarehouseId ? Number(toWarehouseId) : null));

  const submit = handleSubmit((values) =>
    onSubmit({
      product_id: Number(values.product_id),
      from_warehouse_id: Number(values.from_warehouse_id),
      from_location_id: Number(values.from_location_id),
      to_warehouse_id: Number(values.to_warehouse_id),
      to_location_id: Number(values.to_location_id),
      quantity: values.quantity,
      unit_cost: values.unit_cost,
      lot_id: values.lot_id ? Number(values.lot_id) : null,
    }),
  );

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Registrar transferencia</h3>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-slate-600">
          Producto
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('product_id')}
          >
            <option value="">Elige un producto…</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.sku} — {product.name}
              </option>
            ))}
          </select>
          {errors.product_id && (
            <p className="mt-1 text-sm text-red-600">{errors.product_id.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600">
          Cantidad
          <input
            type="text"
            inputMode="decimal"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('quantity')}
          />
          {errors.quantity && (
            <p className="mt-1 text-sm text-red-600">{errors.quantity.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600">
          Coste/ud.
          <input
            type="text"
            inputMode="decimal"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('unit_cost')}
          />
          {errors.unit_cost && (
            <p className="mt-1 text-sm text-red-600">{errors.unit_cost.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600">
          Almacén origen
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('from_warehouse_id')}
          >
            <option value="">Elige…</option>
            {(warehouses.data ?? []).map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
          {errors.from_warehouse_id && (
            <p className="mt-1 text-sm text-red-600">{errors.from_warehouse_id.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600">
          Ubicación origen
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('from_location_id')}
          >
            <option value="">Elige…</option>
            {(fromLocations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          {errors.from_location_id && (
            <p className="mt-1 text-sm text-red-600">{errors.from_location_id.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600">
          Lote (opcional, ID)
          <input
            type="text"
            inputMode="numeric"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('lot_id')}
          />
        </label>

        <label className="text-sm text-slate-600">
          Almacén destino
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('to_warehouse_id')}
          >
            <option value="">Elige…</option>
            {(warehouses.data ?? []).map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
          {errors.to_warehouse_id && (
            <p className="mt-1 text-sm text-red-600">{errors.to_warehouse_id.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600">
          Ubicación destino
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('to_location_id')}
          >
            <option value="">Elige…</option>
            {(toLocations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          {errors.to_location_id && (
            <p className="mt-1 text-sm text-red-600">{errors.to_location_id.message}</p>
          )}
        </label>
      </div>

      {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

      <div className="mt-4">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? 'Registrando…' : 'Registrar transferencia'}
        </button>
      </div>
    </form>
  );
}
