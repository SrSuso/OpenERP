import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router';
import { z } from 'zod';

import { useAuth } from '@/features/auth/useAuth';
import { ApiError } from '@/lib/api';

const loginSchema = z.object({
  email: z.string().min(1, 'Introduce tu email.'),
  password: z.string().min(1, 'Introduce tu contraseña.'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await login(values.email, values.password);
      void navigate(user.must_change_password ? '/change-password' : from, { replace: true });
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.isUnauthenticated
          ? 'Email o contraseña incorrectos.'
          : 'No se ha podido iniciar sesión. Inténtalo de nuevo.',
      );
    }
  });

  return (
    <div className="flex h-full items-center justify-center bg-slate-50">
      <form
        onSubmit={(event) => void onSubmit(event)}
        noValidate
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm"
      >
        <p className="mb-6 text-lg font-semibold text-brand-700">OpenERP</p>

        <div className="mb-4">
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('email')}
          />
          {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>}
        </div>

        <div className="mb-4">
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('password')}
          />
          {errors.password && (
            <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
          )}
        </div>

        {formError && <p className="mb-4 text-sm text-red-600">{formError}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded bg-brand-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Entrar
        </button>
      </form>
    </div>
  );
}
