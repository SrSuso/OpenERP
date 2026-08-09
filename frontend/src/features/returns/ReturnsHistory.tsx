import { useQuery } from '@tanstack/react-query';

import { saleReturnsQuery } from '@/features/returns/api';
import { formatMoney, formatQuantity } from '@/lib/format';

export function ReturnsHistory({ saleId }: { saleId: number }) {
  const returns = useQuery(saleReturnsQuery(saleId));

  if (returns.isPending) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (returns.isError) {
    return <p className="text-sm text-red-600">No se han podido cargar las devoluciones.</p>;
  }
  if (returns.data.length === 0) {
    return <p className="text-sm text-slate-500">Todavía no se ha devuelto nada de esta venta.</p>;
  }

  return (
    <ul className="space-y-2 text-sm">
      {returns.data.map((ret) => (
        <li key={ret.id} className="rounded border border-slate-200 bg-white p-2">
          <p className="text-xs text-slate-500">
            {new Date(ret.created_at).toLocaleString('es-ES')} · reembolso{' '}
            {formatMoney(ret.total_refund)}
            {ret.notes && ` · ${ret.notes}`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {ret.lines.map((line) => (
              <li key={line.id}>
                <span className="font-mono text-xs text-slate-500">{line.product_sku}</span>{' '}
                {formatQuantity(line.quantity_packages)} {line.package_name}
                {line.is_economic && ` · reembolso ${formatMoney(line.refund_amount)}`}
                {line.is_physical && ' · repuesto'}
                {line.lot_number && ` · lote ${line.lot_number}`}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
