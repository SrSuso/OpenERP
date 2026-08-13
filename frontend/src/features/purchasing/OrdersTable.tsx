import { Fragment } from 'react';

import { type Product } from '@/features/catalog/api';
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
  DRAFT: 'bg-slate-100 text-slate-600',
  ORDERED: 'bg-blue-50 text-blue-700',
  PARTIALLY_RECEIVED: 'bg-amber-50 text-amber-700',
  RECEIVED: 'bg-green-50 text-green-700',
  CANCELLED: 'bg-red-50 text-red-600',
};

interface OrdersTableProps {
  orders: PurchaseOrder[];
  products: Product[];
  expandedId: number | null;
  onToggleExpand: (id: number) => void;
  canManagePurchase: boolean;
  canManageReceiving: boolean;
  canManagePricing: boolean;
}

export function OrdersTable({
  orders,
  products,
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
            <th className="px-4 py-2 font-medium">Estado</th>
            <th className="px-4 py-2 font-medium">Total</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <Fragment key={order.id}>
              <tr className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 font-mono text-xs text-slate-500">#{order.id}</td>
                <td className="px-4 py-2 font-medium text-slate-800">{order.supplier_name}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[order.status]}`}
                  >
                    {STATUS_LABELS[order.status]}
                  </span>
                </td>
                <td className="px-4 py-2">{formatMoney(order.total)}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onToggleExpand(order.id)}
                    className="text-sm font-medium text-slate-600 hover:underline"
                  >
                    {expandedId === order.id ? 'Ocultar' : 'Ver detalle'}
                  </button>
                </td>
              </tr>
              {expandedId === order.id && (
                <tr>
                  <td colSpan={5} className="p-0">
                    <OrderDetailPanel
                      order={order}
                      products={products}
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
