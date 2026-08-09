import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { type Supplier } from '@/features/suppliers/api';

const createOrderSchema = z.object({
  supplier_id: z.string().min(1, 'Elige un proveedor.'),
  notes: z.string().max(2000).optional(),
});

type CreateOrderFormValues = z.infer<typeof createOrderSchema>;

interface CreateOrderFormProps {
  suppliers: Supplier[];
  onSubmit: (payload: { supplier_id: number; notes: string }) => void;
  onCancel: () => void;
  isPending: boolean;
  submitError: string | null;
}

export function CreateOrderForm({
  suppliers,
  onSubmit,
  onCancel,
  isPending,
  submitError,
}: CreateOrderFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateOrderFormValues>({ resolver: zodResolver(createOrderSchema) });

  const submit = handleSubmit((values) =>
    onSubmit({ supplier_id: Number(values.supplier_id), notes: values.notes ?? '' }),
  );

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Nuevo pedido de compra</h3>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-slate-600">
          Proveedor
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('supplier_id')}
          >
            <option value="">Elige un proveedor…</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
          {errors.supplier_id && (
            <p className="mt-1 text-sm text-red-600">{errors.supplier_id.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600 sm:col-span-2">
          Notas (opcional)
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('notes')}
          />
        </label>
      </div>

      {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? 'Creando…' : 'Crear'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
