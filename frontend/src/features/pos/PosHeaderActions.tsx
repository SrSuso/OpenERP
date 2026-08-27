import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  PosHeaderActionsContext,
  type NewSaleAction,
} from '@/features/pos/PosHeaderActionsContext';
import { usePosTerminal } from '@/features/pos/usePosTerminal';

const LAST_TICKET_STORAGE_PREFIX = 'openerp.pos.lastTicketSaleId.';

function posLastTicketStorageKey(terminalId: number): string {
  return `${LAST_TICKET_STORAGE_PREFIX}${terminalId}`;
}

function storedLastTicketSaleId(terminalId: number | null): number | null {
  if (terminalId === null) return null;
  const parsed = Number(window.localStorage.getItem(posLastTicketStorageKey(terminalId)));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** El encabezado pertenece al layout, pero abrir una venta pertenece a la
 * pantalla del carrito. Este puente pequeño evita duplicar el estado de la
 * venta sólo para mover su botón al encabezado. */
export function PosHeaderActionsProvider({ children }: { children: ReactNode }) {
  const { selectedTerminal } = usePosTerminal();
  const terminalId = selectedTerminal?.id ?? null;
  const [newSaleAction, setNewSaleAction] = useState<NewSaleAction | null>(null);
  const [lastTicketSaleId, setLastTicketSaleId] = useState<number | null>(() =>
    storedLastTicketSaleId(terminalId),
  );

  // El último ticket pertenece al terminal físico, no a la sesión del
  // cajero. Así se puede reimprimir tras recargar o tras que entre otro
  // usuario en la misma caja, sin mezclar tickets de dos terminales.
  useEffect(() => {
    setLastTicketSaleId(storedLastTicketSaleId(terminalId));
  }, [terminalId]);

  const registerNewSaleAction = useCallback((action: NewSaleAction) => {
    setNewSaleAction(action);
    return () => {
      setNewSaleAction((current) => (current === action ? null : current));
    };
  }, []);

  const rememberLastTicket = useCallback(
    (saleId: number) => {
      if (terminalId === null) return;
      window.localStorage.setItem(posLastTicketStorageKey(terminalId), String(saleId));
      setLastTicketSaleId(saleId);
    },
    [terminalId],
  );

  const value = useMemo(
    () => ({ newSaleAction, lastTicketSaleId, registerNewSaleAction, rememberLastTicket }),
    [newSaleAction, lastTicketSaleId, registerNewSaleAction, rememberLastTicket],
  );

  return (
    <PosHeaderActionsContext.Provider value={value}>{children}</PosHeaderActionsContext.Provider>
  );
}
