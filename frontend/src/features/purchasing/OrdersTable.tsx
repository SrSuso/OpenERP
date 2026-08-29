import { Fragment } from 'react';

import { OrderDetailPanel } from '@/features/purchasing/OrderDetailPanel';
import { type PurchaseOrder } from '@/features/purchasing/api';
import { formatMoney } from '@/lib/format';

const STATUS_LABELS: Record<PurchaseOrder['status'], string> = {
  DRAFT: 'Borrador',
  ORDERED: 'Realizado',
  PARTIALLY_RECEIVED: 'Recibido parcialmente',
  RECEIVED: 'Recibido',
  CANCELLED: 'Cancelado',
};

const STATUS_STYLES: Record<PurchaseOrder['status'], string> = {
  DRAFT: 'border-slate-300 bg-slate-100 text-slate-700',
  ORDERED: 'border-blue-300 bg-blue-100 text-blue-800',
  PARTIALLY_RECEIVED: 'border-amber-300 bg-amber-100 text-amber-800',
  RECEIVED: 'border-green-300 bg-green-100 text-green-800',
  CANCELLED: 'border-red-300 bg-red-100 text-red-700',
};

interface OrdersTableProps {
  orders: PurchaseOrder[];
  expandedId: number | null;
  onToggleExpand: (id: number) => void;
  canManagePurchase: boolean;
  canManageReceiving: boolean;
  canManagePricing: boolean;
}

export function OrdersTable({
  orders,
  expandedId,
  onToggleExpand,
  canManagePurchase,
  canManageReceiving,
  canManagePricing,
}: OrdersTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Nº</th>
            <th className="px-4 py-2 font-medium">Proveedor</th>
            <th className="px-4 py-2 font-medium">Pedido</th>
            <th className="px-4 py-2 font-medium">Estado</th>
            <th className="px-4 py-2 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <Fragment key={order.id}>
              <tr className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 font-mono text-xs text-slate-500">#{order.id}</td>
                <td className="px-4 py-2 font-medium text-slate-800">{order.supplier_name}</td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => onToggleExpand(order.id)}
                    aria-expanded={expandedId === order.id}
                    className="inline-flex min-h-9 items-center rounded border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2"
                  >
                    {expandedId === order.id ? 'Ocultar detalles' : 'Ver detalles'}
                  </button>
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold whitespace-nowrap ${STATUS_STYLES[order.status]}`}
                  >
                    {STATUS_LABELS[order.status]}
                  </span>
                </td>
                <td className="px-4 py-2">{formatMoney(order.total)}</td>
              </tr>
              {expandedId === order.id && (
                <tr>
                  <td colSpan={5} className="p-0">
                    <OrderDetailPanel
                      order={order}
                      canManagePurchase={canManagePurchase}
                      canManageReceiving={canManageReceiving}
                      canManagePricing={canManagePricing}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
