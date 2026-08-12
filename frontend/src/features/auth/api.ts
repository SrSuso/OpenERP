import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, ApiError, apiFetch } from '@/lib/api';

export const meSchema = z.object({
  id: z.number(),
  email: z.string(),
  full_name: z.string(),
  role: z.string(),
  permissions: z.array(z.string()),
  must_change_password: z.boolean().default(false),
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

// --- sesiones activas del usuario que ha iniciado sesión — nunca las de
// otro usuario (ver backend/app/auth/router.py's list_my_sessions/
// revoke_my_session, ambas ancladas a auth_session.user_id) -----------------

export const sessionSchema = z.object({
  id: z.number(),
  created_at: z.string(),
  last_seen_at: z.string(),
  expires_at: z.string(),
  user_agent: z.string().nullable(),
  ip: z.string().nullable(),
  is_current: z.boolean(),
});
export type Session = z.infer<typeof sessionSchema>;

export const mySessionsQuery = queryOptions({
  queryKey: ['auth', 'sessions'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/auth/sessions`, { schema: z.array(sessionSchema), signal }),
});

export async function revokeSession(sessionId: number): Promise<void> {
  await apiFetch(`${API_V1}/auth/sessions/${sessionId}`, { method: 'DELETE', schema: z.null() });
}
