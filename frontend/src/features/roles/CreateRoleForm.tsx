import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const createRoleSchema = z.object({
  name: z.string().min(1, 'Introduce un nombre.').max(50),
  description: z.string().max(255).optional(),
});

type CreateRoleFormValues = z.infer<typeof createRoleSchema>;

interface CreateRoleFormProps {
  onSubmit: (name: string, description: string) => void;
  onCancel: () => void;
  isPending: boolean;
  submitError: string | null;
}

export function CreateRoleForm({
  onSubmit,
  onCancel,
  isPending,
  submitError,
}: CreateRoleFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateRoleFormValues>({ resolver: zodResolver(createRoleSchema) });

  const submit = handleSubmit((values) => onSubmit(values.name, values.description ?? ''));

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Nuevo rol</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-600">
          Nombre
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm uppercase"
            {...register('name')}
          />
          {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
        </label>

        <label className="text-sm text-slate-600">
          Descripción (opcional)
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('description')}
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
