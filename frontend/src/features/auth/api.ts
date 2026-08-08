import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, ApiError, apiFetch } from '@/lib/api';

export const meSchema = z.object({
  id: z.number(),
  email: z.string(),
  full_name: z.string(),
  role: z.string(),
  permissions: z.array(z.string()),
});

export type Me = z.infer<typeof meSchema>;

/**
 * The signed-in user, or `null` when signed out.
 *
 * A 401 here is an *expected* outcome (most visitors are signed out), not a
 * failure — the queryFn resolves it to `null` instead of throwing, so being
 * logged out is representable as real cached data. That matters on logout:
 * `queryClient.setQueryData(meQuery.queryKey, null)` then deterministically
 * clears the user everywhere in one render, instead of hoping a background
 * refetch eventually overwrites stale (and by then wrong) cached data.
 */
export const meQuery = queryOptions({
  queryKey: ['auth', 'me'] as const,
  queryFn: async ({ signal }): Promise<Me | null> => {
    try {
      return await apiFetch(`${API_V1}/auth/me`, { schema: meSchema, signal });
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthenticated) {
        return null;
      }
      throw error;
    }
  },
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
