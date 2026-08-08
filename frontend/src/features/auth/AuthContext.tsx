import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { login as loginRequest, logout as logoutRequest, meQuery, type Me } from '@/features/auth/api';

interface AuthContextValue {
  /** `null` once the initial `/auth/me` call has resolved and the visitor
   * is signed out; `undefined` while that first call is still in flight. */
  user: Me | null | undefined;
  isLoading: boolean;
  hasPermission: (key: string) => boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Hydrates the signed-in user (if any) from `GET /auth/me` and exposes
 * login/logout. Route guards (`RequireAuth`/`RequirePermission`) and layouts
 * read from this — but it is convenience only, the backend re-checks every
 * permission on every request regardless (rule 11).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: user, isPending } = useQuery({
    ...meQuery,
    retry: false,
    // A 401 here just means "signed out", never surface it as a UI error.
    throwOnError: false,
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      user: user ?? null,
      isLoading: isPending,
      hasPermission: (key: string) => user?.permissions.includes(key) ?? false,
      login: async (email: string, password: string) => {
        const me = await loginRequest(email, password);
        queryClient.setQueryData(meQuery.queryKey, me);
        return me;
      },
      logout: async () => {
        await logoutRequest();
        queryClient.setQueryData(meQuery.queryKey, null);
      },
    }),
    [user, isPending, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
