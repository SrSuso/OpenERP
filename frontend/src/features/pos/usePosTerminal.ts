import { useContext } from 'react';

import {
  PosTerminalContext,
  type PosTerminalContextValue,
} from '@/features/pos/PosTerminalContext';

export function usePosTerminal(): PosTerminalContextValue {
  const context = useContext(PosTerminalContext);
  if (!context) throw new Error('usePosTerminal must be used within PosTerminalProvider');
  return context;
}
