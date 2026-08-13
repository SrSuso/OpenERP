import { type StockMovement } from '@/features/inventory/api';
import { useBusinessTimezone } from '@/features/settings/useShopSettings';
import { formatBusinessDateTime } from '@/lib/businessTime';
import { formatMoney, formatQuantity } from '@/lib/format';

const MOVEMENT_LABELS: Record<string, string> = {
  PURCHASE_RECEIPT: 'Recepción de compra',
  SALE: 'Venta',
  ADJUSTMENT: 'Ajuste',
  WASTE: 'Merma',
  TRANSFER_OUT: 'Transferencia (salida)',
  TRANSFER_IN: 'Transferencia (entrada)',
  RETURN: 'Devolución',
};

export function StockMovementsTable({ movements }: { movements: StockMovement[] }) {
  const businessTimezone = useBusinessTimezone();
  if (movements.length === 0) {
    return <p className="text-sm text-slate-500">No hay movimientos con estos filtros.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Fecha</th>
            <th className="px-4 py-2 font-medium">SKU</th>
            <th className="px-4 py-2 font-medium">Tipo</th>
            <th className="px-4 py-2 font-medium">Almacén</th>
            <th className="px-4 py-2 font-medium">Cantidad</th>
            <th className="px-4 py-2 font-medium">Coste/ud.</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((movement) => (
            <tr key={movement.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2 text-xs text-slate-500">
                {formatBusinessDateTime(movement.created_at, businessTimezone)}
              </td>
              <td className="px-4 py-2 font-mono text-xs text-slate-500">{movement.product_sku}</td>
              <td className="px-4 py-2">
                {MOVEMENT_LABELS[movement.movement_type] ?? movement.movement_type}
              </td>
              <td className="px-4 py-2">#{movement.warehouse_id}</td>
              <td
                className={`px-4 py-2 ${Number(movement.quantity) < 0 ? 'text-red-600' : 'text-green-700'}`}
              >
                {formatQuantity(movement.quantity)}
              </td>
              <td className="px-4 py-2">{formatMoney(movement.unit_cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
