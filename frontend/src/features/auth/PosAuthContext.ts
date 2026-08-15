import { createContext } from 'react';

import { type Me } from '@/features/auth/api';

export interface PosAuthContextValue {
  user: Me | null | undefined;
  isLoading: boolean;
  hasPermission: (key: string) => boolean;
  login: (username: string, pin: string) => Promise<Me>;
  logout: () => Promise<void>;
}

export const PosAuthContext = createContext<PosAuthContextValue | null>(null);
