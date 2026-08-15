import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { type Role } from '@/features/roles/api';
import { type UserCreate } from '@/features/users/api';
import { cancelWithConfirm, useUnsavedWarning } from '@/lib/unsaved';

// Mirrors backend/app/users/schemas.py's UserCreate — the backend is the
// real boundary (rule 11), this only gives the person a faster "no" than
// a round trip before it can possibly succeed.
const createUserSchema = z.object({
  email: z.string().min(1, 'Introduce un email.').email('Email no válido.'),
  full_name: z.string().min(1, 'Introduce un nombre.').max(255),
  password: z.string().min(8, 'Al menos 8 caracteres.').max(255),
  role_id: z.coerce.number().int('Elige un rol.').positive('Elige un rol.'),
  pos_username: z.string().trim().min(3).max(64).optional().or(z.literal('')),
  pos_pin: z
    .string()
    .regex(/^\d{4,12}$/)
    .optional()
    .or(z.literal('')),
});

type CreateUserFormValues = z.infer<typeof createUserSchema>;

interface CreateUserFormProps {
  roles: Role[];
  onSubmit: (payload: UserCreate) => void;
  onCancel: () => void;
  isPending: boolean;
  /** Surfaced from the mutation (e.g. "a user with this email already
   * exists") — the form itself only catches shape errors, not conflicts. */
  submitError: string | null;
}

export function CreateUserForm({
  roles,
  onSubmit,
  onCancel,
  isPending,
  submitError,
}: CreateUserFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<CreateUserFormValues>({ resolver: zodResolver(createUserSchema) });

  useUnsavedWarning(isDirty);

  const submit = handleSubmit((values) => {
    const { pos_username, pos_pin, ...user } = values;
    onSubmit({
      ...user,
      ...(pos_username && pos_pin ? { pos_username, pos_pin } : {}),
    });
  });

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Nuevo usuario</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-600">
          Email
          <input
            type="email"
            autoComplete="off"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('email')}
          />
          {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>}
        </label>

        <label className="text-sm text-slate-600">
          Usuario TPV (opcional)
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('pos_username')}
          />
        </label>

        <label className="text-sm text-slate-600">
          PIN TPV (4–12 dígitos)
          <input
            type="password"
            inputMode="numeric"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('pos_pin')}
          />
        </label>

        <label className="text-sm text-slate-600">
          Nombre completo
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('full_name')}
          />
          {errors.full_name && (
            <p className="mt-1 text-sm text-red-600">{errors.full_name.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600">
          Contraseña provisional
          <input
            type="text"
            autoComplete="off"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('password')}
          />
          {errors.password && (
            <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600">
          Rol
          <select
            defaultValue=""
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('role_id')}
          >
            <option value="" disabled>
              Elige un rol…
            </option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
          {errors.role_id && <p className="mt-1 text-sm text-red-600">{errors.role_id.message}</p>}
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
          onClick={cancelWithConfirm(isDirty, onCancel)}
          className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
