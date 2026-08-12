import { type PriceHistoryEntry } from '@/features/pricing/api';
import { formatMoney, formatRate } from '@/lib/format';

/** Histórico de cambios de precio de un producto — una fila por cada vez
 * que su fórmula, su precio manual, o un cambio de coste/margen/impuestos
 * con fórmula activa recalculó `list_price` (backend/app/pricing/service.py's
 * `_record_history`, nunca se edita ni se borra). */
export function ProductPriceHistoryTable({ entries }: { entries: PriceHistoryEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">Este producto no tiene cambios de precio.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase text-slate-500">
        <tr>
          <th className="py-1 pr-3 font-medium">Fecha</th>
          <th className="py-1 pr-3 font-medium">Coste</th>
          <th className="py-1 pr-3 font-medium">IVA</th>
          <th className="py-1 pr-3 font-medium">Recargo</th>
          <th className="py-1 pr-3 font-medium">Margen</th>
          <th className="py-1 pr-3 font-medium">Margen fijo</th>
          <th className="py-1 pr-3 font-medium">Fórmula</th>
          <th className="py-1 pr-3 font-medium">PVP</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id} className="border-t border-slate-200">
            <td className="py-1 pr-3 text-xs text-slate-500">
              {new Date(entry.created_at).toLocaleString('es-ES')}
            </td>
            <td className="py-1 pr-3">{formatMoney(entry.cost)}</td>
            <td className="py-1 pr-3">{formatRate(entry.tax_rate)}%</td>
            <td className="py-1 pr-3">{formatRate(entry.surcharge_rate)}%</td>
            <td className="py-1 pr-3">{formatRate(entry.margin_rate)}%</td>
            <td className="py-1 pr-3">{formatMoney(entry.margin_amount)}</td>
            <td className="py-1 pr-3 font-mono text-xs">
              {entry.price_formula ?? <span className="text-slate-400">manual / tienda</span>}
            </td>
            <td className="py-1 pr-3 font-medium">{formatMoney(entry.list_price)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
