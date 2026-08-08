import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

export const meSchema = z.object({
  id: z.number(),
  email: z.string(),
  full_name: z.string(),
  role: z.string(),
  permissions: z.array(z.string()),
});

export type Me = z.infer<typeof meSchema>;

/** The signed-in user, or a 401 `ApiError` when signed out. Cached under a
 * stable key so `AuthProvider` can rewrite it directly after login/logout
 * instead of re-fetching. */
export const meQuery = queryOptions({
  queryKey: ['auth', 'me'] as const,
  queryFn: ({ signal }) => apiFetch(`${API_V1}/auth/me`, { schema: meSchema, signal }),
});

export async function login(email: string, password: string): Promise<Me> {
  return apiFetch(`${API_V1}/auth/login`, {
    method: 'POST',
    schema: meSchema,
    body: { email, password },
  });
}

export async function logout(): Promise<void> {
  await apiFetch(`${API_V1}/auth/logout`, { method: 'POST', schema: z.null() });
}
