import { useContext } from 'react';

import { PosAuthContext } from '@/features/auth/PosAuthContext';

export function usePosAuth() {
  const context = useContext(PosAuthContext);
  if (!context) throw new Error('usePosAuth must be used within PosAuthProvider.');
  return context;
}
