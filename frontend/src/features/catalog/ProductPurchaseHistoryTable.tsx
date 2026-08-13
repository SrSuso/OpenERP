import { type ProductPurchaseHistoryEntry } from '@/features/purchasing/api';
import { useBusinessTimezone } from '@/features/settings/useShopSettings';
import { formatBusinessDate } from '@/lib/businessTime';
import { formatMoney, formatQuantity } from '@/lib/format';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  ORDERED: 'Realizado',
  PARTIALLY_RECEIVED: 'Recibido parcialmente',
  RECEIVED: 'Recibido',
  CANCELLED: 'Cancelado',
};

/** Pestaña "Compras" de la ficha de producto — histórico de líneas de
 * pedido de compra para este producto, sólo lectura (backend/app/
 * purchasing/router.py's `GET /products/{id}/purchase-history`). */
export function ProductPurchaseHistoryTable({
  entries,
}: {
  entries: ProductPurchaseHistoryEntry[];
}) {
  const businessTimezone = useBusinessTimezone();
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">Este producto no se ha comprado todavía.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase text-slate-500">
        <tr>
          <th className="py-1 pr-3 font-medium">Fecha</th>
          <th className="py-1 pr-3 font-medium">Pedido</th>
          <th className="py-1 pr-3 font-medium">Proveedor</th>
          <th className="py-1 pr-3 font-medium">Formato</th>
          <th className="py-1 pr-3 font-medium">Cantidad</th>
          <th className="py-1 pr-3 font-medium">Coste/ud.</th>
          <th className="py-1 pr-3 font-medium">Estado</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, index) => (
          <tr key={`${entry.purchase_order_id}-${index}`} className="border-t border-slate-200">
            <td className="py-1 pr-3 text-xs text-slate-500">
              {formatBusinessDate(entry.date, businessTimezone)}
            </td>
            <td className="py-1 pr-3">#{entry.purchase_order_id}</td>
            <td className="py-1 pr-3">{entry.supplier_name}</td>
            <td className="py-1 pr-3">{entry.package_name}</td>
            <td className="py-1 pr-3">{formatQuantity(entry.quantity_packages)}</td>
            <td className="py-1 pr-3">{formatMoney(entry.unit_cost)}</td>
            <td className="py-1 pr-3">{STATUS_LABELS[entry.status] ?? entry.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
