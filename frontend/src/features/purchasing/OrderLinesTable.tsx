import { type PurchaseOrderLine } from '@/features/purchasing/api';
import { formatMoney, formatQuantity } from '@/lib/format';

interface OrderLinesTableProps {
  lines: PurchaseOrderLine[];
  canRemove: boolean;
  canEdit: boolean;
  onRemove: (lineId: number) => void;
  onEdit: (lineId: number) => void;
  isRemoving: boolean;
}

export function OrderLinesTable({
  lines,
  canRemove,
  canEdit,
  onRemove,
  onEdit,
  isRemoving,
}: OrderLinesTableProps) {
  if (lines.length === 0) {
    return <p className="text-sm text-slate-500">Este pedido todavía no tiene líneas.</p>;
  }

  return (
    <table className="mb-3 w-full text-left text-sm">
      <thead className="text-xs uppercase text-slate-500">
        <tr>
          <th className="py-1 pr-3 font-medium">Producto</th>
          <th className="py-1 pr-3 font-medium">Unidad</th>
          <th className="py-1 pr-3 font-medium">Pedido</th>
          <th className="py-1 pr-3 font-medium">Recibido</th>
          <th className="py-1 pr-3 font-medium">Coste/ud.</th>
          <th className="py-1 pr-3 font-medium">Total</th>
          {(canRemove || canEdit) && <th className="py-1 pr-3 font-medium" />}
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.id} className="border-t border-slate-200">
            <td className="py-1 pr-3">{line.product_name}</td>
            <td className="py-1 pr-3">{line.package_name}</td>
            <td className="py-1 pr-3">{formatQuantity(line.quantity_packages)}</td>
            <td className="py-1 pr-3">
              {formatQuantity(String(Number(line.quantity_received) / Number(line.package_factor)))}
            </td>
            <td className="py-1 pr-3">{formatMoney(line.unit_cost)}</td>
            <td className="py-1 pr-3">{formatMoney(line.total)}</td>
            {(canRemove || canEdit) && (
              <td className="py-1 pr-3 text-right">
                <div className="flex justify-end gap-3">
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => onEdit(line.id)}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      Editar
                    </button>
                  )}
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(line.id)}
                      disabled={isRemoving}
                      className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
                    >
                      Quitar
                    </button>
                  )}
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
