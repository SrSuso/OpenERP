import { createContext, useContext } from 'react';

export interface NewSaleAction {
  onPress: () => void;
  disabled: boolean;
}

export interface PosHeaderActionsValue {
  newSaleAction: NewSaleAction | null;
  lastTicketSaleId: number | null;
  registerNewSaleAction: (action: NewSaleAction) => () => void;
  rememberLastTicket: (saleId: number) => void;
}

const EMPTY_ACTIONS: PosHeaderActionsValue = {
  newSaleAction: null,
  lastTicketSaleId: null,
  registerNewSaleAction: () => () => undefined,
  rememberLastTicket: () => undefined,
};

export const PosHeaderActionsContext = createContext<PosHeaderActionsValue>(EMPTY_ACTIONS);

export function usePosHeaderActions(): PosHeaderActionsValue {
  return useContext(PosHeaderActionsContext);
}
