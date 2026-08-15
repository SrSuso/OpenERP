import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

export const userSchema = z.object({
  id: z.number(),
  email: z.string(),
  full_name: z.string(),
  is_active: z.boolean(),
  must_change_password: z.boolean().default(false),
  role_id: z.number(),
  role_name: z.string(),
  pos_username: z.string().nullable().default(null),
  pos_pin_configured: z.boolean().default(false),
});
export type User = z.infer<typeof userSchema>;

export const usersQuery = queryOptions({
  queryKey: ['users'] as const,
  queryFn: ({ signal }) => apiFetch(`${API_V1}/users`, { schema: z.array(userSchema), signal }),
});

export interface UserCreate {
  email: string;
  full_name: string;
  password: string;
  role_id: number;
  pos_username?: string;
  pos_pin?: string;
}

export async function createUser(payload: UserCreate): Promise<User> {
  return apiFetch(`${API_V1}/users`, {
    method: 'POST',
    schema: userSchema,
    body: payload,
  });
}

export async function updateUserRole(userId: number, roleId: number): Promise<User> {
  return apiFetch(`${API_V1}/users/${userId}`, {
    method: 'PATCH',
    schema: userSchema,
    body: { role_id: roleId },
  });
}

export async function deactivateUser(userId: number): Promise<User> {
  return apiFetch(`${API_V1}/users/${userId}/deactivate`, {
    method: 'POST',
    schema: userSchema,
  });
}

export async function activateUser(userId: number): Promise<User> {
  return apiFetch(`${API_V1}/users/${userId}/activate`, {
    method: 'POST',
    schema: userSchema,
  });
}

export async function resetUserPassword(userId: number, temporaryPassword: string): Promise<void> {
  await apiFetch(`${API_V1}/users/${userId}/reset-password`, {
    method: 'POST',
    schema: z.null(),
    body: { temporary_password: temporaryPassword },
  });
}

export async function setUserPosCredentials(
  userId: number,
  payload: { pos_username: string; pos_pin: string },
): Promise<User> {
  return apiFetch(`${API_V1}/users/${userId}/pos-credentials`, {
    method: 'PUT',
    schema: userSchema,
    body: payload,
  });
}

/** `POST /users/me/password` — any signed-in user, no `users.manage`
 * needed (backend only ever touches the caller's own row). */
export async function changeMyPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await apiFetch(`${API_V1}/users/me/password`, {
    method: 'POST',
    schema: z.null(),
    body: { current_password: currentPassword, new_password: newPassword },
  });
}
