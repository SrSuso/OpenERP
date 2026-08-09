import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'Introduce tu contraseña actual.'),
    new_password: z.string().min(8, 'Al menos 8 caracteres.').max(255),
    confirm_password: z.string().min(1, 'Repite la contraseña nueva.'),
  })
  .refine((values) => values.new_password === values.confirm_password, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirm_password'],
  });

type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;

interface ChangePasswordFormProps {
  onSubmit: (currentPassword: string, newPassword: string) => void;
  isPending: boolean;
  submitError: string | null;
  success: boolean;
}

export function ChangePasswordForm({
  onSubmit,
  isPending,
  submitError,
  success,
}: ChangePasswordFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordFormValues>({ resolver: zodResolver(changePasswordSchema) });

  const submit = handleSubmit((values) => {
    onSubmit(values.current_password, values.new_password);
    reset();
  });

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="max-w-sm rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Cambiar contraseña</h3>

      <div className="mb-3">
        <label className="text-sm text-slate-600">
          Contraseña actual
          <input
            type="password"
            autoComplete="current-password"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('current_password')}
          />
        </label>
        {errors.current_password && (
          <p className="mt-1 text-sm text-red-600">{errors.current_password.message}</p>
        )}
      </div>

      <div className="mb-3">
        <label className="text-sm text-slate-600">
          Contraseña nueva
          <input
            type="password"
            autoComplete="new-password"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('new_password')}
          />
        </label>
        {errors.new_password && (
          <p className="mt-1 text-sm text-red-600">{errors.new_password.message}</p>
        )}
      </div>

      <div className="mb-3">
        <label className="text-sm text-slate-600">
          Repite la contraseña nueva
          <input
            type="password"
            autoComplete="new-password"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('confirm_password')}
          />
        </label>
        {errors.confirm_password && (
          <p className="mt-1 text-sm text-red-600">{errors.confirm_password.message}</p>
        )}
      </div>

      {submitError && <p className="mb-3 text-sm text-red-600">{submitError}</p>}
      {success && <p className="mb-3 text-sm text-green-700">Contraseña actualizada.</p>}

      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? 'Guardando…' : 'Guardar'}
      </button>
    </form>
  );
}
