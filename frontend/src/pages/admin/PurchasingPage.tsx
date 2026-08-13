import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/features/auth/useAuth';
import { productsQuery } from '@/features/catalog/api';
import { CreateOrderForm } from '@/features/purchasing/CreateOrderForm';
import { OrdersTable } from '@/features/purchasing/OrdersTable';
import {
  addOrderLine,
  createOrder,
  purchaseOrdersQuery,
  type OrderLineInput,
} from '@/features/purchasing/api';
import { suppliersQuery } from '@/features/suppliers/api';

import { pageHeaderRow, primaryAction } from './pageActions';

const STATUS_FILTERS = ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const;

const STATUS_FILTER_LABELS: Record<(typeof STATUS_FILTERS)[number], string> = {
  DRAFT: 'Borrador',
  ORDERED: 'Realizado',
  PARTIALLY_RECEIVED: 'Recibido parcialmente',
  RECEIVED: 'Recibido',
  CANCELLED: 'Cancelado',
};

/** `/admin/purchasing` — gated by `purchase.read`; managing orders needs
 * `purchase.manage`, recording receipts needs `receiving.manage` (both
 * checked independently, see backend/app/rbac/permissions.py's phases 6/9). */
export function PurchasingPage() {
  const { hasPermission } = useAuth();
  const canManagePurchase = hasPermission('purchase.manage');
  const canManageReceiving = hasPermission('receiving.manage');
  const canManagePricing = hasPermission('pricing.manage');

  const [status, setStatus] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const orders = useQuery(purchaseOrdersQuery(status === '' ? {} : { status }));
  const suppliers = useQuery(suppliersQuery(true));
  const products = useQuery(productsQuery({ activeOnly: true }));
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (payload: {
      supplier_id: number;
      notes: string;
      lines: OrderLineInput[];
    }) => {
      const order = await createOrder({ supplier_id: payload.supplier_id, notes: payload.notes });
      // El backend sólo crea el pedido en sí (POST /purchase-orders no
      // acepta líneas) — se añaden una a una justo después para que, desde
      // el punto de vista de quien lo crea, sea un único paso.
      for (const line of payload.lines) {
        await addOrderLine(order.id, line);
      }
      return order;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['purchasing', 'orders'] });
      setShowCreateForm(false);
      setCreateError(null);
    },
    onError: () => setCreateError('No se ha podido crear el pedido.'),
  });

  return (
    <section>
      <div className={pageHeaderRow}>
        <div>
          <h1 className="text-2xl font-semibold">Compras y recepciones</h1>
          <label className="mt-2 block text-sm text-slate-600">
            Estado
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="mt-1 block rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="">Todos</option>
              {STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {STATUS_FILTER_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {canManagePurchase && !showCreateForm && (
          <button type="button" onClick={() => setShowCreateForm(true)} className={primaryAction}>
            Nuevo pedido
          </button>
        )}
      </div>

      {showCreateForm && (
        <CreateOrderForm
          suppliers={suppliers.data ?? []}
          products={products.data ?? []}
          isPending={createMutation.isPending}
          submitError={createError}
          onCancel={() => {
            setShowCreateForm(false);
            setCreateError(null);
          }}
          onSubmit={(payload) => createMutation.mutate(payload)}
        />
      )}

      {orders.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {orders.isError && (
        <p className="text-sm text-red-600">No se han podido cargar los pedidos.</p>
      )}

      {orders.data && orders.data.length === 0 && (
        <p className="text-sm text-slate-500">No hay pedidos de compra todavía.</p>
      )}

      {orders.data && orders.data.length > 0 && (
        <OrdersTable
          orders={orders.data}
          products={products.data ?? []}
          expandedId={expandedId}
          onToggleExpand={(id) => setExpandedId((current) => (current === id ? null : id))}
          canManagePurchase={canManagePurchase}
          canManageReceiving={canManageReceiving}
          canManagePricing={canManagePricing}
        />
      )}
    </section>
  );
}
