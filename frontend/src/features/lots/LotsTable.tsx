import { Button } from '@/components/ui';
import { type Lot } from '@/features/lots/api';
import { expirationDays, localExpirationDate } from '@/features/lots/expiration';

function formatDate(iso: string | null): string {
  if (iso === null) return '—';
  return new Intl.DateTimeFormat('es-ES').format(localExpirationDate(iso));
}

function statusFor(
  lot: Lot,
  alertedDays: number | undefined,
): { label: string; className: string } {
  const days = expirationDays(lot);
  if (days === null) return { label: 'Sin caducidad', className: 'text-slate-500' };
  if (days < 0) {
    return {
      label: 'Caducado',
      className: 'rounded-full bg-red-100 px-2.5 py-1 font-bold text-red-800',
    };
  }
  if (days === 0) {
    return {
      label: 'Caduca hoy',
      className: 'rounded-full bg-amber-100 px-2.5 py-1 font-bold text-amber-900',
    };
  }
  if (days === 1) {
    return {
      label: 'Caduca mañana',
      className: 'rounded-full bg-amber-100 px-2.5 py-1 font-bold text-amber-900',
    };
  }
  if (alertedDays !== undefined) {
    return {
      label: `Caduca en ${alertedDays} días`,
      className: 'rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-800',
    };
  }
  return { label: formatDate(lot.expiration_date), className: 'text-slate-600' };
}

export function LotsTable({
  lots,
  productNames,
  alertDaysByLot,
  selectedLotId,
  onInspect,
}: {
  lots: Lot[];
  productNames: Map<number, string>;
  alertDaysByLot: Map<number, number>;
  selectedLotId?: number | null;
  onInspect?: (lot: Lot) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-5 py-3">Producto</th>
            <th className="px-5 py-3">Lote</th>
            <th className="px-5 py-3">Caducidad</th>
            <th className="px-5 py-3">Estado</th>
            {onInspect && <th className="px-5 py-3 text-right">Existencias</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lots.map((lot) => {
            const status = statusFor(lot, alertDaysByLot.get(lot.id));
            return (
              <tr
                key={lot.id}
                className={selectedLotId === lot.id ? 'bg-brand-50' : 'hover:bg-slate-50'}
              >
                <td className="px-5 py-4 font-semibold text-slate-900">
                  {productNames.get(lot.product_id) ?? 'Producto no disponible'}
                </td>
                <td className="px-5 py-4 text-slate-700">{lot.lot_number}</td>
                <td className="px-5 py-4 text-slate-600">{formatDate(lot.expiration_date)}</td>
                <td className="px-5 py-4">
                  <span className={status.className}>{status.label}</span>
                </td>
                {onInspect && (
                  <td className="px-5 py-4 text-right">
                    <Button
                      variant="ghost"
                      className="min-h-8 px-3 py-1"
                      aria-label={`Ver existencias de ${productNames.get(lot.product_id) ?? 'producto'}, lote ${lot.lot_number}`}
                      onClick={() => onInspect(lot)}
                    >
                      Ver existencias
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
