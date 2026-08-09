import { type ProductPurchaseHistoryEntry } from '@/features/purchasing/api';
import { formatMoney } from '@/lib/format';

interface SupplierSummaryRow {
  supplierName: string;
  purchases: number;
  lastDate: string;
  lastUnitCost: string;
  avgUnitCost: string;
}

function summarize(entries: ProductPurchaseHistoryEntry[]): SupplierSummaryRow[] {
  const bySupplier = new Map<string, ProductPurchaseHistoryEntry[]>();
  for (const entry of entries) {
    const list = bySupplier.get(entry.supplier_name) ?? [];
    list.push(entry);
    bySupplier.set(entry.supplier_name, list);
  }

  const rows = [...bySupplier.entries()].map(([supplierName, group]) => {
    const sorted = [...group].sort((a, b) => b.date.localeCompare(a.date));
    const avg = group.reduce((sum, e) => sum + Number(e.unit_cost), 0) / group.length;
    return {
      supplierName,
      purchases: group.length,
      lastDate: sorted[0]!.date,
      lastUnitCost: sorted[0]!.unit_cost,
      avgUnitCost: avg.toFixed(6),
    };
  });

  // El más barato de media primero — es justo la comparación que se busca
  // aquí: a quién le sale más a cuenta volver a comprarle.
  return rows.sort((a, b) => Number(a.avgUnitCost) - Number(b.avgUnitCost));
}

/** Resumen por proveedor de todo el historial de compras de un producto —
 * pensado explícitamente para responder "a quién se lo he comprado y a
 * qué precio, para valorar a quién volver a comprarle" (por eso ordena por
 * coste medio, el más barato primero), en vez de vincular manualmente un
 * proveedor "preferido" sin relación con lo que de verdad se ha pagado. */
export function SupplierPurchaseSummary({ entries }: { entries: ProductPurchaseHistoryEntry[] }) {
  const rows = summarize(entries);
  if (rows.length === 0) return null;

  return (
    <table className="mb-4 w-full text-left text-sm">
      <thead className="text-xs uppercase text-slate-500">
        <tr>
          <th className="py-1 pr-3 font-medium">Proveedor</th>
          <th className="py-1 pr-3 font-medium">Nº de compras</th>
          <th className="py-1 pr-3 font-medium">Última compra</th>
          <th className="py-1 pr-3 font-medium">Último coste</th>
          <th className="py-1 pr-3 font-medium">Coste medio</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.supplierName} className="border-t border-slate-200">
            <td className="py-1 pr-3 font-medium text-slate-800">{row.supplierName}</td>
            <td className="py-1 pr-3">{row.purchases}</td>
            <td className="py-1 pr-3 text-xs text-slate-500">
              {new Date(row.lastDate).toLocaleDateString('es-ES')}
            </td>
            <td className="py-1 pr-3">{formatMoney(row.lastUnitCost)}</td>
            <td className="py-1 pr-3">{formatMoney(row.avgUnitCost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
