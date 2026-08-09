import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { type LotCreateInput } from '@/features/lots/api';
import { type Supplier } from '@/features/suppliers/api';

const createLotSchema = z.object({
  lot_number: z.string().min(1, 'Introduce un número de lote.').max(100),
  manufacturing_date: z.string().optional(),
  expiration_date: z.string().optional(),
  supplier_id: z.string().optional(),
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
    formState: { errors },
  } = useForm<CreateLotFormValues>({ resolver: zodResolver(createLotSchema) });

  const submit = handleSubmit((values) => {
    onSubmit({
      product_id: productId,
      lot_number: values.lot_number,
      manufacturing_date:
        values.manufacturing_date === '' ? null : (values.manufacturing_date ?? null),
      expiration_date: values.expiration_date === '' ? null : (values.expiration_date ?? null),
      supplier_id: values.supplier_id ? Number(values.supplier_id) : null,
      purchase_order_id: null,
    });
    reset({ lot_number: '', manufacturing_date: '', expiration_date: '', supplier_id: '' });
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
