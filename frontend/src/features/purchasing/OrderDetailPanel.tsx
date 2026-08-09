import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

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
}

export function OrderDetailPanel({
  order,
  products,
  canManagePurchase,
  canManageReceiving,
}: OrderDetailPanelProps) {
  const [showReceiptForm, setShowReceiptForm] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
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

  const placeMutation = useMutation({
    mutationFn: () => placeOrder(order.id),
    onSuccess: invalidateOrders,
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelOrder(order.id),
    onSuccess: invalidateOrders,
  });

  const receiptMutation = useMutation({
    mutationFn: (payload: {
      warehouse_id: number;
      location_id: number;
      notes: string;
      lines: GoodsReceiptLineInput[];
    }) => createGoodsReceipt(order.id, payload),
    onSuccess: () => {
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

  return (
    <div className="border-t border-slate-100 bg-slate-50 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-slate-700">
          Estado: {STATUS_LABELS[order.status]}
        </span>
        {canManagePurchase && order.status === 'DRAFT' && (
          <button
            type="button"
            onClick={() => placeMutation.mutate()}
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
        onRemove={(lineId) => removeLineMutation.mutate(lineId)}
        isRemoving={removeLineMutation.isPending}
      />
      {canManagePurchase && order.status === 'DRAFT' && (
        <AddOrderLineForm
          products={products}
          onSubmit={(payload) => addLineMutation.mutate(payload)}
          isPending={addLineMutation.isPending}
        />
      )}

      <h5 className="mt-4 mb-1 text-xs font-semibold uppercase text-slate-500">Recepciones</h5>
      <ReceiptsList orderId={order.id} />
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
              setShowReceiptForm(false);
              setReceiptError(null);
            }}
            onSubmit={(payload) => receiptMutation.mutate(payload)}
          />
        </div>
      )}
    </div>
  );
}
