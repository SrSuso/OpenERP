import { createContext, useContext } from 'react';

export interface NewSaleAction {
  onPress: () => void;
  disabled: boolean;
}

export interface PosHeaderActionsValue {
  newSaleAction: NewSaleAction | null;
  registerNewSaleAction: (action: NewSaleAction) => () => void;
}

const EMPTY_ACTIONS: PosHeaderActionsValue = {
  newSaleAction: null,
  registerNewSaleAction: () => () => undefined,
};

export const PosHeaderActionsContext = createContext<PosHeaderActionsValue>(EMPTY_ACTIONS);

export function usePosHeaderActions(): PosHeaderActionsValue {
  return useContext(PosHeaderActionsContext);
}
