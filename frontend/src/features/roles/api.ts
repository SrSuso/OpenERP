import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

export const roleSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  permissions: z.array(z.string()),
});
export type Role = z.infer<typeof roleSchema>;

export const permissionSchema = z.object({
  id: z.number(),
  key: z.string(),
  description: z.string(),
});
export type Permission = z.infer<typeof permissionSchema>;

/** Readable by anyone with `users.manage` OR `roles.manage` (see
 * backend/app/rbac/router.py) — a MANAGER needs this to assign a role
 * when creating a user, even though it can't create/edit roles itself. */
export const rolesQuery = queryOptions({
  queryKey: ['roles'] as const,
  queryFn: ({ signal }) => apiFetch(`${API_V1}/roles`, { schema: z.array(roleSchema), signal }),
});

export const permissionsQuery = queryOptions({
  queryKey: ['permissions'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/permissions`, { schema: z.array(permissionSchema), signal }),
});

export async function createRole(name: string, description: string): Promise<Role> {
  return apiFetch(`${API_V1}/roles`, {
    method: 'POST',
    schema: roleSchema,
    body: { name, description },
  });
}

export async function setRolePermissions(roleId: number, permissionKeys: string[]): Promise<Role> {
  return apiFetch(`${API_V1}/roles/${roleId}/permissions`, {
    method: 'PATCH',
    schema: roleSchema,
    body: { permission_keys: permissionKeys },
  });
}
