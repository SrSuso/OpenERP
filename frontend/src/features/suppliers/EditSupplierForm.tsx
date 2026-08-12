import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { type Supplier, type SupplierUpdateInput } from '@/features/suppliers/api';
import { cancelWithConfirm, useUnsavedWarning } from '@/lib/unsaved';

const editSupplierSchema = z.object({
  name: z.string().min(1, 'Introduce un nombre.').max(255),
  tax_id: z.string().max(50).optional(),
  email: z.string().max(255).optional(),
  phone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
});

type EditSupplierFormValues = z.infer<typeof editSupplierSchema>;

interface EditSupplierFormProps {
  supplier: Supplier;
  onSubmit: (payload: SupplierUpdateInput) => void;
  onCancel: () => void;
  isPending: boolean;
  submitError: string | null;
}

export function EditSupplierForm({
  supplier,
  onSubmit,
  onCancel,
  isPending,
  submitError,
}: EditSupplierFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<EditSupplierFormValues>({
    resolver: zodResolver(editSupplierSchema),
    defaultValues: {
      name: supplier.name,
      tax_id: supplier.tax_id ?? '',
      email: supplier.email ?? '',
      phone: supplier.phone ?? '',
      address: supplier.address,
    },
  });

  useUnsavedWarning(isDirty);

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
      className="mb-4 rounded-lg border border-brand-200 bg-brand-50/40 p-4"
    >
      <h4 className="mb-3 text-sm font-semibold text-slate-700">Editar «{supplier.name}»</h4>

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
          NIF/CIF
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('tax_id')}
          />
        </label>

        <label className="text-sm text-slate-600">
          Email
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('email')}
          />
        </label>

        <label className="text-sm text-slate-600">
          Teléfono
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('phone')}
          />
        </label>

        <label className="text-sm text-slate-600 sm:col-span-3">
          Dirección
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
          {isPending ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={cancelWithConfirm(isDirty, onCancel)}
          className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
