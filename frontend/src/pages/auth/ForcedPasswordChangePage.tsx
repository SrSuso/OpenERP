import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { useAuth } from '@/features/auth/AuthContext';
import { ChangePasswordForm } from '@/features/users/ChangePasswordForm';
import { changeMyPassword } from '@/features/users/api';
import { ApiError } from '@/lib/api';

/** The only application screen available to a temporary-password session. */
export function ForcedPasswordChangePage() {
  const { markPasswordChanged } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) =>
      changeMyPassword(current, next),
    onSuccess: () => {
      markPasswordChanged();
      void navigate('/', { replace: true });
    },
    onError: (err: unknown) =>
      setError(
        err instanceof ApiError && err.code === 'validation_error'
          ? 'La contraseña temporal no es correcta.'
          : 'No se ha podido cambiar la contraseña.',
      ),
  });

  return (
    <main className="flex h-full items-center justify-center bg-slate-50 p-4">
      <section>
        <h1 className="mb-2 text-xl font-semibold text-slate-800">Elige una contraseña nueva</h1>
        <p className="mb-4 max-w-sm text-sm text-slate-600">
          Has entrado con una contraseña temporal. Debes cambiarla antes de acceder al sistema.
        </p>
        <ChangePasswordForm
          isPending={mutation.isPending}
          submitError={error}
          success={false}
          onSubmit={(current, next) => mutation.mutate({ current, next })}
        />
      </section>
    </main>
  );
}
