import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';

import { AuthContext, type AuthContextValue } from '@/features/auth/AuthContext';
import {
  login as loginRequest,
  logout as logoutRequest,
  meQuery,
  type Me,
} from '@/features/auth/api';

/**
 * Hydrates the signed-in user (if any) from `GET /auth/me` and exposes
 * login/logout. Route guards (`RequireAuth`/`RequirePermission`) and layouts
 * read from this — but it is convenience only, the backend re-checks every
 * permission on every request regardless (rule 11).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: user, isPending } = useQuery({ ...meQuery, retry: false });

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading: isPending,
      hasPermission: (key: string) => user?.permissions.includes(key) ?? false,
      login: async (email: string, password: string) => {
        const me = await loginRequest(email, password);
        queryClient.setQueryData(meQuery.queryKey, me);
        return me;
      },
      logout: async () => {
        await logoutRequest();
        // Deterministic: meQuery resolves an unauthenticated /auth/me to
        // `null` (see its queryFn), so this is a real, type-safe value —
        // not a hope that some later background refetch clears stale data.
        queryClient.setQueryData(meQuery.queryKey, null);
      },
      markPasswordChanged: () => {
        queryClient.setQueryData<Me | null>(meQuery.queryKey, (current) =>
          current ? { ...current, must_change_password: false } : current,
        );
      },
    }),
    [user, isPending, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
