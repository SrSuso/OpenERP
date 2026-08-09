import { type StockBalance } from '@/features/inventory/api';
import { formatQuantity } from '@/lib/format';

export function StockBalanceTable({ balances }: { balances: StockBalance[] }) {
  if (balances.length === 0) {
    return <p className="text-sm text-slate-500">No hay saldo de stock con estos filtros.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">SKU</th>
            <th className="px-4 py-2 font-medium">Almacén</th>
            <th className="px-4 py-2 font-medium">Ubicación</th>
            <th className="px-4 py-2 font-medium">Lote</th>
            <th className="px-4 py-2 font-medium">Cantidad</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((balance, index) => (
            <tr
              key={`${balance.product_id}-${balance.warehouse_id}-${balance.location_id}-${balance.lot_id ?? 'none'}-${index}`}
              className="border-b border-slate-100 last:border-0"
            >
              <td className="px-4 py-2 font-mono text-xs text-slate-500">{balance.product_sku}</td>
              <td className="px-4 py-2">#{balance.warehouse_id}</td>
              <td className="px-4 py-2">#{balance.location_id}</td>
              <td className="px-4 py-2">{balance.lot_id ?? '—'}</td>
              <td className="px-4 py-2">{formatQuantity(balance.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
