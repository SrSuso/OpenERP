import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import { ChangePasswordForm } from '@/features/users/ChangePasswordForm';
import { changeMyPassword } from '@/features/users/api';
import { ApiError } from '@/lib/api';

/** `/admin/account` — reachable by anyone signed into the panel, no extra
 * permission gate (the backend only ever touches the caller's own row,
 * see `POST /users/me/password`). Where the default bootstrap admin
 * password (docs/ADMIN_GUIDE.md §2.5) is meant to actually get changed. */
export function AccountPage() {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) =>
      changeMyPassword(current, next),
    onSuccess: () => {
      setError(null);
      setSuccess(true);
    },
    onError: (err: unknown) => {
      setSuccess(false);
      setError(
        err instanceof ApiError && err.code === 'validation_error'
          ? 'La contraseña actual no es correcta.'
          : 'No se ha podido cambiar la contraseña.',
      );
    },
  });

  return (
    <section>
      <h1 className="text-2xl font-semibold">Mi cuenta</h1>

      {user && (
        <p className="mt-2 text-sm text-slate-500">
          {user.full_name} · {user.email} · <span className="text-slate-400">{user.role}</span>
        </p>
      )}

      <div className="mt-6">
        <ChangePasswordForm
          isPending={mutation.isPending}
          submitError={error}
          success={success}
          onSubmit={(current, next) => {
            setSuccess(false);
            mutation.mutate({ current, next });
          }}
        />
      </div>
    </section>
  );
}
