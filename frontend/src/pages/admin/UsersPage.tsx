import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import { rolesQuery } from '@/features/roles/api';
import { CreateUserForm } from '@/features/users/CreateUserForm';
import {
  createUser,
  deactivateUser,
  updateUserRole,
  usersQuery,
  type UserCreate,
} from '@/features/users/api';
import { UsersTable } from '@/features/users/UsersTable';
import { ApiError } from '@/lib/api';

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

  const createMutation = useMutation({
    mutationFn: (payload: UserCreate) => createUser(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersQuery.queryKey });
      setShowCreateForm(false);
      setCreateError(null);
    },
    onError: (error: unknown) => {
      setCreateError(
        error instanceof ApiError && error.code === 'conflict'
          ? 'Ya existe un usuario con ese email.'
          : 'No se ha podido crear el usuario.',
      );
    },
  });

  const changeRoleMutation = useMutation({
    mutationFn: ({ userId, roleId }: { userId: number; roleId: number }) =>
      updateUserRole(userId, roleId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: usersQuery.queryKey }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (userId: number) => deactivateUser(userId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: usersQuery.queryKey }),
  });

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        {!showCreateForm && (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            Nuevo usuario
          </button>
        )}
      </div>

      {showCreateForm && (
        <CreateUserForm
          roles={roles.data ?? []}
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

      {users.data && currentUser && (
        <UsersTable
          users={users.data}
          roles={roles.data ?? []}
          currentUserId={currentUser.id}
          isChangingRole={changeRoleMutation.isPending}
          isDeactivating={deactivateMutation.isPending}
          onChangeRole={(userId, roleId) => changeRoleMutation.mutate({ userId, roleId })}
          onDeactivate={(userId) => deactivateMutation.mutate(userId)}
        />
      )}
    </section>
  );
}
