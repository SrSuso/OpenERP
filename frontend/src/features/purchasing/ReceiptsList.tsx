import { useQuery } from '@tanstack/react-query';

import { goodsReceiptsQuery } from '@/features/purchasing/api';
import { useBusinessTimezone } from '@/features/settings/useShopSettings';
import { formatBusinessDateTime } from '@/lib/businessTime';
import { formatQuantity } from '@/lib/format';

interface ReceiptsListProps {
  orderId: number;
}

export function ReceiptsList({ orderId }: ReceiptsListProps) {
  const businessTimezone = useBusinessTimezone();
  const receipts = useQuery(goodsReceiptsQuery(orderId));

  if (receipts.isPending) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (receipts.isError) {
    return <p className="text-sm text-red-600">No se han podido cargar las recepciones.</p>;
  }
  if (receipts.data.length === 0) {
    return <p className="text-sm text-slate-500">Todavía no se ha recibido nada de este pedido.</p>;
  }

  return (
    <ul className="space-y-2 text-sm">
      {receipts.data.map((receipt) => (
        <li key={receipt.id} className="rounded border border-slate-200 bg-white p-2">
          <p className="text-xs text-slate-500">
            {formatBusinessDateTime(receipt.received_at, businessTimezone)}
            {receipt.notes && ` · ${receipt.notes}`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {receipt.lines.map((line) => (
              <li key={line.id}>
                <span className="font-mono text-xs text-slate-500">{line.product_sku}</span>{' '}
                {formatQuantity(line.quantity_packages)}
                {line.lot_number && ` · lote ${line.lot_number}`}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
