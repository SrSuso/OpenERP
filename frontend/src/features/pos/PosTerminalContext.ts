import { createContext } from 'react';

import { type PosTerminal } from '@/features/pos/api';

export interface PosTerminalContextValue {
  terminals: PosTerminal[];
  selectedTerminal: PosTerminal | null;
  isLoading: boolean;
  isError: boolean;
  selectionOpen: boolean;
  storedTerminalUnavailable: boolean;
  selectTerminal: (terminalId: number) => void;
  requestTerminalChange: () => void;
  cancelTerminalChange: () => void;
}

export const PosTerminalContext = createContext<PosTerminalContextValue | null>(null);
