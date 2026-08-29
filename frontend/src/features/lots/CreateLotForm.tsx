import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { locationsQuery, warehousesQuery } from '@/features/inventory/api';
import { useDefaultToFirstOption } from '@/features/inventory/useDefaultToFirstOption';
import { type LotCreateInput } from '@/features/lots/api';
import { type Supplier } from '@/features/suppliers/api';
import { decimalString } from '@/lib/decimal';

const createLotSchema = z
  .object({
    lot_number: z.string().min(1, 'Introduce un número de lote.').max(100),
    manufacturing_date: z.string().optional(),
    expiration_date: z.string().optional(),
    supplier_id: z.string().optional(),
    opening_quantity: decimalString({ min: 0 }),
    opening_warehouse_id: z.string(),
    opening_location_id: z.string(),
  })
  .superRefine((values, context) => {
    if (Number(values.opening_quantity.replace(',', '.')) <= 0) return;
    if (values.opening_warehouse_id === '') {
      context.addIssue({
        code: 'custom',
        path: ['opening_warehouse_id'],
        message: 'Elige el almacén del stock inicial.',
      });
    }
    if (values.opening_location_id === '') {
      context.addIssue({
        code: 'custom',
        path: ['opening_location_id'],
        message: 'Elige la ubicación del stock inicial.',
      });
    }
  });

type CreateLotFormValues = z.infer<typeof createLotSchema>;

interface CreateLotFormProps {
  productId: number;
  suppliers: Supplier[];
  onSubmit: (payload: LotCreateInput) => void;
  isPending: boolean;
  submitError: string | null;
}

export function CreateLotForm({
  productId,
  suppliers,
  onSubmit,
  isPending,
  submitError,
}: CreateLotFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateLotFormValues>({
    resolver: zodResolver(createLotSchema),
    defaultValues: {
      opening_quantity: '0',
      opening_warehouse_id: '',
      opening_location_id: '',
    },
  });
  const openingQuantity = watch('opening_quantity');
  const warehouseId = watch('opening_warehouse_id');
  const warehouses = useQuery(warehousesQuery);
  const locations = useQuery(locationsQuery(warehouseId ? Number(warehouseId) : null));

  useDefaultToFirstOption(warehouseId, warehouses.data, (value) =>
    setValue('opening_warehouse_id', value),
  );
  const locationId = watch('opening_location_id');
  useDefaultToFirstOption(locationId, locations.data, (value) =>
    setValue('opening_location_id', value),
  );

  const submit = handleSubmit((values) => {
    onSubmit({
      product_id: productId,
      lot_number: values.lot_number,
      manufacturing_date:
        values.manufacturing_date === '' ? null : (values.manufacturing_date ?? null),
      expiration_date: values.expiration_date === '' ? null : (values.expiration_date ?? null),
      supplier_id: values.supplier_id ? Number(values.supplier_id) : null,
      purchase_order_id: null,
      opening_stock:
        Number(values.opening_quantity.replace(',', '.')) > 0
          ? {
              warehouse_id: Number(values.opening_warehouse_id),
              location_id: Number(values.opening_location_id),
              quantity: values.opening_quantity.replace(',', '.'),
            }
          : null,
    });
    reset({
      lot_number: '',
      manufacturing_date: '',
      expiration_date: '',
      supplier_id: '',
      opening_quantity: '0',
      opening_warehouse_id: '',
      opening_location_id: '',
    });
  });

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-4"
    >
      <label className="text-sm text-slate-600">
        Nº de lote
        <input
          type="text"
          className="mt-1 block w-32 rounded border border-slate-300 px-3 py-1.5 text-sm"
          {...register('lot_number')}
        />
        {errors.lot_number && (
          <p className="mt-1 text-sm text-red-600">{errors.lot_number.message}</p>
        )}
      </label>

      <fieldset className="flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2">
        <legend className="px-1 text-xs font-medium text-slate-600">
          Stock inicial (opcional)
        </legend>
        <label className="text-sm text-slate-600">
          Cantidad
          <input
            type="text"
            inputMode="decimal"
            className="mt-1 block w-24 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
            {...register('opening_quantity')}
          />
          {errors.opening_quantity && (
            <p className="mt-1 text-sm text-red-600">{errors.opening_quantity.message}</p>
          )}
        </label>
        <label className="text-sm text-slate-600">
          Almacén
          <select
            disabled={openingQuantity === '0'}
            className="mt-1 block w-40 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:bg-slate-100"
            {...register('opening_warehouse_id')}
          >
            <option value="">Elige un almacén…</option>
            {(warehouses.data ?? []).map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
          {errors.opening_warehouse_id && (
            <p className="mt-1 text-sm text-red-600">{errors.opening_warehouse_id.message}</p>
          )}
        </label>
        <label className="text-sm text-slate-600">
          Ubicación
          <select
            disabled={openingQuantity === '0'}
            className="mt-1 block w-40 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:bg-slate-100"
            {...register('opening_location_id')}
          >
            <option value="">Elige una ubicación…</option>
            {(locations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          {errors.opening_location_id && (
            <p className="mt-1 text-sm text-red-600">{errors.opening_location_id.message}</p>
          )}
        </label>
      </fieldset>

      <label className="text-sm text-slate-600">
        Fabricación (opcional)
        <input
          type="date"
          className="mt-1 block rounded border border-slate-300 px-3 py-1.5 text-sm"
          {...register('manufacturing_date')}
        />
      </label>

      <label className="text-sm text-slate-600">
        Caducidad (opcional)
        <input
          type="date"
          className="mt-1 block rounded border border-slate-300 px-3 py-1.5 text-sm"
          {...register('expiration_date')}
        />
      </label>

      <label className="text-sm text-slate-600">
        Proveedor (opcional)
        <select
          className="mt-1 block w-48 rounded border border-slate-300 px-3 py-1.5 text-sm"
          {...register('supplier_id')}
        >
          <option value="">Sin proveedor</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-brand-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? 'Creando…' : 'Crear lote'}
      </button>

      {submitError && <p className="w-full text-sm text-red-600">{submitError}</p>}
    </form>
  );
}
