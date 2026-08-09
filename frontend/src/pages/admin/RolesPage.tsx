import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { CreateRoleForm } from '@/features/roles/CreateRoleForm';
import { RoleCard } from '@/features/roles/RoleCard';
import { createRole, permissionsQuery, rolesQuery, setRolePermissions } from '@/features/roles/api';
import { ApiError } from '@/lib/api';

/** `/admin/roles` — gated by `roles.manage` in routes.tsx (only ADMIN has
 * it by default). Backend already had full role/permission CRUD (phase 1);
 * this is the panel screen for it. */
export function RolesPage() {
  const roles = useQuery(rolesQuery);
  const permissions = useQuery(permissionsQuery);
  const queryClient = useQueryClient();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [savingRoleId, setSavingRoleId] = useState<number | null>(null);

  const createMutation = useMutation({
    mutationFn: ({ name, description }: { name: string; description: string }) =>
      createRole(name, description),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rolesQuery.queryKey });
      setShowCreateForm(false);
      setCreateError(null);
    },
    onError: (error: unknown) => {
      setCreateError(
        error instanceof ApiError && error.code === 'conflict'
          ? 'Ya existe un rol con ese nombre.'
          : 'No se ha podido crear el rol.',
      );
    },
  });

  const savePermissionsMutation = useMutation({
    mutationFn: ({ roleId, keys }: { roleId: number; keys: string[] }) =>
      setRolePermissions(roleId, keys),
    onMutate: ({ roleId }) => setSavingRoleId(roleId),
    onSettled: () => setSavingRoleId(null),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: rolesQuery.queryKey }),
  });

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Roles</h1>
        {!showCreateForm && (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            Nuevo rol
          </button>
        )}
      </div>

      {showCreateForm && (
        <CreateRoleForm
          isPending={createMutation.isPending}
          submitError={createError}
          onCancel={() => {
            setShowCreateForm(false);
            setCreateError(null);
          }}
          onSubmit={(name, description) => createMutation.mutate({ name, description })}
        />
      )}

      {(roles.isPending || permissions.isPending) && (
        <p className="text-sm text-slate-500">Cargando…</p>
      )}
      {(roles.isError || permissions.isError) && (
        <p className="text-sm text-red-600">No se han podido cargar los roles.</p>
      )}

      {roles.data && permissions.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          {roles.data.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              permissions={permissions.data}
              isSaving={savingRoleId === role.id}
              onSave={(keys) => savePermissionsMutation.mutate({ roleId: role.id, keys })}
            />
          ))}
        </div>
      )}
    </section>
  );
}
