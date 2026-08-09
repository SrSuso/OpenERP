import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { type SupplierCreateInput } from '@/features/suppliers/api';

const createSupplierSchema = z.object({
  name: z.string().min(1, 'Introduce un nombre.').max(255),
  tax_id: z.string().max(50).optional(),
  email: z.string().max(255).optional(),
  phone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
});

type CreateSupplierFormValues = z.infer<typeof createSupplierSchema>;

interface CreateSupplierFormProps {
  onSubmit: (payload: SupplierCreateInput) => void;
  onCancel: () => void;
  isPending: boolean;
  submitError: string | null;
}

export function CreateSupplierForm({
  onSubmit,
  onCancel,
  isPending,
  submitError,
}: CreateSupplierFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateSupplierFormValues>({ resolver: zodResolver(createSupplierSchema) });

  const submit = handleSubmit((values) =>
    onSubmit({
      name: values.name,
      tax_id: values.tax_id === '' ? null : (values.tax_id ?? null),
      email: values.email === '' ? null : (values.email ?? null),
      phone: values.phone === '' ? null : (values.phone ?? null),
      address: values.address ?? '',
    }),
  );

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Nuevo proveedor</h3>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-slate-600 sm:col-span-2">
          Nombre
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('name')}
          />
          {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
        </label>

        <label className="text-sm text-slate-600">
          NIF/CIF (opcional)
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('tax_id')}
          />
        </label>

        <label className="text-sm text-slate-600">
          Email (opcional)
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('email')}
          />
        </label>

        <label className="text-sm text-slate-600">
          Teléfono (opcional)
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('phone')}
          />
        </label>

        <label className="text-sm text-slate-600 sm:col-span-3">
          Dirección (opcional)
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('address')}
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
