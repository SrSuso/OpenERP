import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import { rolesQuery } from '@/features/roles/api';
import { CreateUserForm } from '@/features/users/CreateUserForm';
import {
  activateUser,
  createUser,
  deactivateUser,
  resetUserPassword,
  updateUserRole,
  usersQuery,
  type User,
  type UserCreate,
} from '@/features/users/api';
import { UsersTable } from '@/features/users/UsersTable';
import { ApiError } from '@/lib/api';

import { pageTitleRow, primaryAction } from './pageActions';

/** `/admin/users` — gated by `users.manage` in routes.tsx. Full CRUD lives
 * on the backend already (phase 1); this is just the panel screen for it,
 * so users no longer have to go through Swagger UI/curl for the routine
 * case (docs/ADMIN_GUIDE.md §5). */
export function UsersPage() {
  const { user: currentUser } = useAuth();
  const users = useQuery(usersQuery);
  // Readable with users.manage too (see backend/app/rbac/router.py) — a
  // MANAGER without roles.manage still needs this to assign a role here.
  const roles = useQuery(rolesQuery);
  const queryClient = useQueryClient();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState('');

  const assignableRoles = (roles.data ?? []).filter((role) =>
    role.permissions.every((permission) => currentUser?.permissions.includes(permission) ?? false),
  );

  const createMutation = useMutation({
    mutationFn: (payload: UserCreate) => createUser(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersQuery.queryKey });
      setShowCreateForm(false);
      setCreateError(null);
    },
    onError: (error: unknown) => {
      setCreateError(
        error instanceof ApiError
          ? error.code === 'conflict'
            ? 'Ya existe un usuario con ese email.'
            : error.code === 'permission_denied'
              ? 'No puedes asignar ese rol porque contiene permisos que no posees.'
              : 'No se ha podido crear el usuario.'
          : 'No se ha podido crear el usuario.',
      );
    },
  });

  const changeRoleMutation = useMutation({
    mutationFn: ({ userId, roleId }: { userId: number; roleId: number }) =>
      updateUserRole(userId, roleId),
    onSuccess: () => {
      setOperationError(null);
      void queryClient.invalidateQueries({ queryKey: usersQuery.queryKey });
    },
    onError: (error: unknown) =>
      setOperationError(
        error instanceof ApiError && error.code === 'permission_denied'
          ? 'No puedes asignar un rol con permisos superiores a los tuyos.'
          : 'No se ha podido cambiar el rol.',
      ),
  });

  const deactivateMutation = useMutation({
    mutationFn: (userId: number) => deactivateUser(userId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: usersQuery.queryKey }),
  });

  const activateMutation = useMutation({
    mutationFn: (userId: number) => activateUser(userId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: usersQuery.queryKey }),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: number; password: string }) =>
      resetUserPassword(userId, password),
    onSuccess: () => {
      setResetTarget(null);
      setTemporaryPassword('');
      setOperationError(null);
    },
    onError: () => setOperationError('No se ha podido restablecer la contraseña.'),
  });

  return (
    <section>
      <div className={pageTitleRow}>
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        {!showCreateForm && (
          <button type="button" onClick={() => setShowCreateForm(true)} className={primaryAction}>
            Nuevo usuario
          </button>
        )}
      </div>

      {showCreateForm && (
        <CreateUserForm
          roles={assignableRoles}
          isPending={createMutation.isPending}
          submitError={createError}
          onCancel={() => {
            setShowCreateForm(false);
            setCreateError(null);
          }}
          onSubmit={(payload) => createMutation.mutate(payload)}
        />
      )}

      {users.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {users.isError && (
        <p className="text-sm text-red-600">No se han podido cargar los usuarios.</p>
      )}
      {operationError && <p className="mb-3 text-sm text-red-600">{operationError}</p>}

      {resetTarget && (
        <form
          className="mb-4 max-w-md rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            resetPasswordMutation.mutate({
              userId: resetTarget.id,
              password: temporaryPassword,
            });
          }}
        >
          <h2 className="text-sm font-semibold text-slate-800">
            Restablecer contraseña de {resetTarget.full_name}
          </h2>
          <label className="mt-3 block text-sm text-slate-600">
            Contraseña temporal
            <input
              type="password"
              minLength={12}
              maxLength={255}
              required
              autoComplete="new-password"
              value={temporaryPassword}
              onChange={(event) => setTemporaryPassword(event.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <p className="mt-2 text-xs text-slate-500">
            Se cerrarán sus sesiones y tendrá que elegir otra contraseña al entrar.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={resetPasswordMutation.isPending || temporaryPassword.length < 12}
              className="rounded bg-brand-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Guardar contraseña temporal
            </button>
            <button
              type="button"
              onClick={() => {
                setResetTarget(null);
                setTemporaryPassword('');
              }}
              className="rounded px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {users.data && currentUser && (
        <UsersTable
          users={users.data}
          roles={assignableRoles}
          currentUserId={currentUser.id}
          isChangingRole={changeRoleMutation.isPending}
          isDeactivating={deactivateMutation.isPending}
          isActivating={activateMutation.isPending}
          onChangeRole={(userId, roleId) => changeRoleMutation.mutate({ userId, roleId })}
          onDeactivate={(userId) => deactivateMutation.mutate(userId)}
          onActivate={(userId) => activateMutation.mutate(userId)}
          onResetPassword={(userId) => {
            setOperationError(null);
            setTemporaryPassword('');
            setResetTarget(users.data.find((user) => user.id === userId) ?? null);
          }}
        />
      )}
    </section>
  );
}
