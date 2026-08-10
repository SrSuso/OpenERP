import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import { productsQuery } from '@/features/catalog/api';
import { AdjustmentForm } from '@/features/inventory/AdjustmentForm';
import { StockBalanceTable } from '@/features/inventory/StockBalanceTable';
import { TransferForm } from '@/features/inventory/TransferForm';
import {
  rebuildStockBalance,
  recordAdjustment,
  recordTransfer,
  stockBalanceQuery,
  warehousesQuery,
  type AdjustmentInput,
  type TransferInput,
} from '@/features/inventory/api';
import { ApiError } from '@/lib/api';

export function InventoryBalancesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('inventory.manage');

  const [warehouseId, setWarehouseId] = useState('');
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [rebuildMessage, setRebuildMessage] = useState<string | null>(null);

  const warehouses = useQuery(warehousesQuery);
  const products = useQuery(productsQuery({ activeOnly: true }));
  const balances = useQuery(
    stockBalanceQuery(warehouseId === '' ? {} : { warehouseId: Number(warehouseId) }),
  );
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['inventory', 'balances'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory', 'movements'] });
  };

  const adjustmentMutation = useMutation({
    mutationFn: (payload: AdjustmentInput) => recordAdjustment(payload),
    onSuccess: () => {
      invalidate();
      setShowAdjustmentForm(false);
      setAdjustmentError(null);
    },
    onError: (error: unknown) =>
      setAdjustmentError(
        error instanceof ApiError ? error.message : 'No se ha podido registrar el ajuste.',
      ),
  });

  const transferMutation = useMutation({
    mutationFn: (payload: TransferInput) => recordTransfer(payload),
    onSuccess: () => {
      invalidate();
      setShowTransferForm(false);
      setTransferError(null);
    },
    onError: (error: unknown) =>
      setTransferError(
        error instanceof ApiError ? error.message : 'No se ha podido registrar la transferencia.',
      ),
  });

  const rebuildMutation = useMutation({
    mutationFn: () => rebuildStockBalance(),
    onSuccess: (rows) => {
      invalidate();
      setRebuildMessage(`Inventario reconstruido: ${rows} saldos recalculados.`);
    },
    onError: () => setRebuildMessage('No se ha podido reconstruir el inventario.'),
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <label className="text-sm text-slate-600">
          Almacén
          <select
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
            className="mt-1 block rounded border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="">Todos</option>
            {(warehouses.data ?? []).map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </label>

        {canManage && (
          <div className="flex gap-2">
            {!showAdjustmentForm && (
              <button
                type="button"
                onClick={() => setShowAdjustmentForm(true)}
                className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
              >
                Nuevo ajuste
              </button>
            )}
            {!showTransferForm && (
              <button
                type="button"
                onClick={() => setShowTransferForm(true)}
                className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
              >
                Nueva transferencia
              </button>
            )}
            <button
              type="button"
              disabled={rebuildMutation.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    '¿Reconstruir el inventario? Recalcula todos los saldos desde el histórico de movimientos — úsalo sólo si algo no cuadra.',
                  )
                ) {
                  setRebuildMessage(null);
                  rebuildMutation.mutate();
                }
              }}
              className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              {rebuildMutation.isPending ? 'Reconstruyendo…' : 'Reconstruir inventario'}
            </button>
          </div>
        )}
      </div>

      {rebuildMessage && <p className="mb-4 text-sm text-slate-600">{rebuildMessage}</p>}

      {showAdjustmentForm && (
        <AdjustmentForm
          products={products.data ?? []}
          isPending={adjustmentMutation.isPending}
          submitError={adjustmentError}
          onSubmit={(payload) => adjustmentMutation.mutate(payload)}
        />
      )}

      {showTransferForm && (
        <TransferForm
          products={products.data ?? []}
          isPending={transferMutation.isPending}
          submitError={transferError}
          onSubmit={(payload) => transferMutation.mutate(payload)}
        />
      )}

      {balances.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {balances.isError && (
        <p className="text-sm text-red-600">No se han podido cargar los saldos.</p>
      )}
      {balances.data && <StockBalanceTable balances={balances.data} />}
    </div>
  );
}
