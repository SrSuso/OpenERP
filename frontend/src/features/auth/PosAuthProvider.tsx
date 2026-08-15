import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';

import { PosAuthContext, type PosAuthContextValue } from '@/features/auth/PosAuthContext';
import { posLogin, posLogout, posMeQuery } from '@/features/auth/api';

export function PosAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: user, isPending } = useQuery({ ...posMeQuery, retry: false });
  const value = useMemo<PosAuthContextValue>(
    () => ({
      user,
      isLoading: isPending,
      hasPermission: (key) => user?.permissions.includes(key) ?? false,
      login: async (username, pin) => {
        const me = await posLogin(username, pin);
        queryClient.setQueryData(posMeQuery.queryKey, me);
        return me;
      },
      logout: async () => {
        await posLogout();
        queryClient.setQueryData(posMeQuery.queryKey, null);
      },
    }),
    [isPending, queryClient, user],
  );
  return <PosAuthContext.Provider value={value}>{children}</PosAuthContext.Provider>;
}
