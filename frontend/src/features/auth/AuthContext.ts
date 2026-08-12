import { createContext } from 'react';

import { type Me } from '@/features/auth/api';

export interface AuthContextValue {
  /** `undefined` while the initial `/auth/me` call is in flight; `null`
   * once it has resolved to "signed out"; the user otherwise. */
  user: Me | null | undefined;
  isLoading: boolean;
  hasPermission: (key: string) => boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  markPasswordChanged: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
