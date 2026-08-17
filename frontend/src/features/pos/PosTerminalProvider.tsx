import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';

import { posTerminalsQuery } from '@/features/pos/api';
import {
  PosTerminalContext,
  type PosTerminalContextValue,
} from '@/features/pos/PosTerminalContext';

export const POS_TERMINAL_STORAGE_KEY = 'openerp.pos.terminalId';

function storedTerminalId(): number | null {
  const raw = window.localStorage.getItem(POS_TERMINAL_STORAGE_KEY);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** The register belongs to the browser installation, not to the signed-in
 * cashier. Consequently logout never clears this localStorage key. */
export function PosTerminalProvider({ children }: { children: ReactNode }) {
  const [configuredId, setConfiguredId] = useState(storedTerminalId);
  const [changing, setChanging] = useState(configuredId === null);
  const query = useQuery({
    ...posTerminalsQuery(true),
    // La preferencia del buscador pertenece a esta caja. Consultarla cada
    // pocos segundos permite activarla o quitarla desde Administración sin
    // recargar el TPV ni interrumpir el carrito que esté abierto.
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });
  const terminals = useMemo(() => query.data ?? [], [query.data]);
  const selectedTerminal = terminals.find((terminal) => terminal.id === configuredId) ?? null;
  const storedTerminalUnavailable =
    query.data !== undefined && configuredId !== null && selectedTerminal === null;

  const value = useMemo<PosTerminalContextValue>(
    () => ({
      terminals,
      selectedTerminal,
      isLoading: query.isPending,
      isError: query.isError,
      selectionOpen: changing || selectedTerminal === null,
      storedTerminalUnavailable,
      selectTerminal: (terminalId) => {
        window.localStorage.setItem(POS_TERMINAL_STORAGE_KEY, String(terminalId));
        setConfiguredId(terminalId);
        setChanging(false);
      },
      requestTerminalChange: () => setChanging(true),
      cancelTerminalChange: () => setChanging(false),
    }),
    [
      terminals,
      selectedTerminal,
      query.isPending,
      query.isError,
      changing,
      storedTerminalUnavailable,
    ],
  );

  return <PosTerminalContext.Provider value={value}>{children}</PosTerminalContext.Provider>;
}
