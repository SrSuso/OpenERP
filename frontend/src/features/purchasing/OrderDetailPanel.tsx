import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { type Product } from '@/features/catalog/api';
import { AddOrderLineForm } from '@/features/purchasing/AddOrderLineForm';
import { GoodsReceiptForm } from '@/features/purchasing/GoodsReceiptForm';
import { OrderLinesTable } from '@/features/purchasing/OrderLinesTable';
import { ReceiptsList } from '@/features/purchasing/ReceiptsList';
import {
  addOrderLine,
  cancelOrder,
  createGoodsReceipt,
  placeOrder,
  removeOrderLine,
  updateOrderLine,
  type GoodsReceiptLineInput,
  type OrderLineInput,
  type PurchaseOrder,
} from '@/features/purchasing/api';
import { ApiError } from '@/lib/api';

const STATUS_LABELS: Record<PurchaseOrder['status'], string> = {
  DRAFT: 'Borrador',
  ORDERED: 'Realizado',
  PARTIALLY_RECEIVED: 'Recibido parcialmente',
  RECEIVED: 'Recibido',
  CANCELLED: 'Cancelado',
};

interface OrderDetailPanelProps {
  order: PurchaseOrder;
  products: Product[];
  canManagePurchase: boolean;
  canManageReceiving: boolean;
  canManagePricing: boolean;
}

export function OrderDetailPanel({
  order,
  products,
  canManagePurchase,
  canManageReceiving,
  canManagePricing,
}: OrderDetailPanelProps) {
  const [showReceiptForm, setShowReceiptForm] = useState(false);
  const [editingLineId, setEditingLineId] = useState<number | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const placeAttemptRef = useRef<string | null>(null);
  const receiptAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const queryClient = useQueryClient();

  const invalidateOrders = () =>
    void queryClient.invalidateQueries({ queryKey: ['purchasing', 'orders'] });
  const invalidateReceipts = () =>
    void queryClient.invalidateQueries({ queryKey: ['purchasing', 'receipts', order.id] });

  const addLineMutation = useMutation({
    mutationFn: (payload: OrderLineInput) => addOrderLine(order.id, payload),
    onSuccess: invalidateOrders,
  });

  const removeLineMutation = useMutation({
    mutationFn: (lineId: number) => removeOrderLine(order.id, lineId),
    onSuccess: invalidateOrders,
  });

  const updateLineMutation = useMutation({
    mutationFn: ({ lineId, payload }: { lineId: number; payload: OrderLineInput }) =>
      updateOrderLine(order.id, lineId, payload),
    onSuccess: () => {
      setEditingLineId(null);
      invalidateOrders();
    },
  });

  const placeMutation = useMutation({
    mutationFn: (key: string) => placeOrder(order.id, key),
    onSuccess: () => {
      placeAttemptRef.current = null;
      invalidateOrders();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelOrder(order.id),
    onSuccess: () => {
      placeAttemptRef.current = null;
      receiptAttemptRef.current = null;
      invalidateOrders();
    },
  });

  const receiptMutation = useMutation({
    mutationFn: ({
      payload,
      key,
    }: {
      payload: {
        warehouse_id: number;
        location_id: number;
        notes: string;
        lines: GoodsReceiptLineInput[];
      };
      key: string;
    }) => createGoodsReceipt(order.id, payload, key),
    onSuccess: () => {
      receiptAttemptRef.current = null;
      invalidateOrders();
      invalidateReceipts();
      setShowReceiptForm(false);
      setReceiptError(null);
    },
    onError: (error: unknown) =>
      setReceiptError(
        error instanceof ApiError ? error.message : 'No se ha podido registrar la recepción.',
      ),
  });

  const canReceive =
    canManageReceiving && (order.status === 'ORDERED' || order.status === 'PARTIALLY_RECEIVED');
  const editingLine =
    editingLineId === null ? undefined : order.lines.find((line) => line.id === editingLineId);

  return (
    <div className="border-t border-slate-100 bg-slate-50 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-slate-700">
          Estado: {STATUS_LABELS[order.status]}
        </span>
        {canManagePurchase && order.status === 'DRAFT' && (
          <button
            type="button"
            onClick={() => {
              const key = placeAttemptRef.current ?? crypto.randomUUID();
              placeAttemptRef.current = key;
              placeMutation.mutate(key);
            }}
            disabled={placeMutation.isPending || order.lines.length === 0}
            className="rounded bg-brand-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Realizar pedido
          </button>
        )}
        {canManagePurchase && (order.status === 'DRAFT' || order.status === 'ORDERED') && (
          <button
            type="button"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-600 disabled:opacity-50"
          >
            Cancelar pedido
          </button>
        )}
      </div>

      <h5 className="mb-1 text-xs font-semibold uppercase text-slate-500">Líneas</h5>
      <OrderLinesTable
        lines={order.lines}
        canRemove={canManagePurchase && order.status === 'DRAFT'}
        canEdit={canManagePurchase && order.status === 'DRAFT'}
        onRemove={(lineId) => removeLineMutation.mutate(lineId)}
        onEdit={setEditingLineId}
        isRemoving={removeLineMutation.isPending}
      />
      {canManagePurchase && order.status === 'DRAFT' && (
        <AddOrderLineForm
          key={editingLineId ?? 'new'}
          products={products}
          {...(editingLine === undefined ? {} : { initialLine: editingLine })}
          onSubmit={(payload) => {
            if (editingLineId !== null) {
              updateLineMutation.mutate({ lineId: editingLineId, payload });
              return;
            }
            addLineMutation.mutate(payload);
          }}
          isPending={addLineMutation.isPending || updateLineMutation.isPending}
          submitLabel={editingLineId === null ? 'Añadir línea' : 'Guardar cambios'}
          {...(editingLineId === null ? {} : { onCancel: () => setEditingLineId(null) })}
        />
      )}

      <h5 className="mt-4 mb-1 text-xs font-semibold uppercase text-slate-500">Recepciones</h5>
      <ReceiptsList orderId={order.id} canManagePricing={canManagePricing} />
      {canReceive && !showReceiptForm && (
        <button
          type="button"
          onClick={() => setShowReceiptForm(true)}
          className="mt-2 rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-white"
        >
          Registrar recepción
        </button>
      )}
      {canReceive && showReceiptForm && (
        <div className="mt-2">
          <GoodsReceiptForm
            order={order}
            isPending={receiptMutation.isPending}
            submitError={receiptError}
            onCancel={() => {
              receiptAttemptRef.current = null;
              setShowReceiptForm(false);
              setReceiptError(null);
            }}
            onSubmit={(payload) => {
              const fingerprint = JSON.stringify(payload);
              const existing = receiptAttemptRef.current;
              const attempt =
                existing?.fingerprint === fingerprint
                  ? existing
                  : { fingerprint, key: crypto.randomUUID() };
              receiptAttemptRef.current = attempt;
              receiptMutation.mutate({ payload, key: attempt.key });
            }}
          />
        </div>
      )}
    </div>
  );
}
