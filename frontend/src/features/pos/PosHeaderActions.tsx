import { useCallback, useMemo, useState, type ReactNode } from 'react';

import {
  PosHeaderActionsContext,
  type NewSaleAction,
} from '@/features/pos/PosHeaderActionsContext';

/** El encabezado pertenece al layout, pero abrir una venta pertenece a la
 * pantalla del carrito. Este puente pequeño evita duplicar el estado de la
 * venta sólo para mover su botón al encabezado. */
export function PosHeaderActionsProvider({ children }: { children: ReactNode }) {
  const [newSaleAction, setNewSaleAction] = useState<NewSaleAction | null>(null);

  const registerNewSaleAction = useCallback((action: NewSaleAction) => {
    setNewSaleAction(action);
    return () => {
      setNewSaleAction((current) => (current === action ? null : current));
    };
  }, []);

  const value = useMemo(
    () => ({ newSaleAction, registerNewSaleAction }),
    [newSaleAction, registerNewSaleAction],
  );

  return (
    <PosHeaderActionsContext.Provider value={value}>{children}</PosHeaderActionsContext.Provider>
  );
}
