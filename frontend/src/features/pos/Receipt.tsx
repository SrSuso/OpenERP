import { type Sale } from '@/features/pos/api';
import { formatMoney } from '@/lib/format';

interface ReceiptProps {
  sale: Sale;
  onDismiss: () => void;
}

/**
 * The brief confirmation shown right after a successful checkout (phase
 * 13) — total charged, how it was paid and any change due. Printing an
 * actual 58/80mm ticket is phase 15; this is only the on-screen
 * confirmation the cashier needs before handing back change and moving on.
 */
export function Receipt({ sale, onDismiss }: ReceiptProps) {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div>
        <p className="text-lg font-medium text-emerald-400">Venta cobrada</p>
        <p className="mt-2 text-4xl font-bold text-slate-50">{formatMoney(sale.total)}</p>
      </div>

      <ul className="w-full max-w-xs space-y-1 text-sm text-slate-300">
        {sale.payments.map((payment) => (
          <li key={payment.id} className="flex justify-between">
            <span>{payment.method === 'CASH' ? 'Efectivo' : 'Tarjeta'}</span>
            <span>{formatMoney(payment.amount)}</span>
          </li>
        ))}
      </ul>

      {Number(sale.change_due) > 0 && (
        <div className="rounded-lg bg-slate-800 px-6 py-3">
          <p className="text-sm text-slate-400">Cambio a entregar</p>
          <p className="text-2xl font-semibold text-slate-50">{formatMoney(sale.change_due)}</p>
        </div>
      )}

      <button
        type="button"
        onClick={onDismiss}
        className="rounded-lg bg-emerald-600 px-8 py-3 text-base font-semibold text-white hover:bg-emerald-500"
      >
        Nueva venta
      </button>
    </div>
  );
}
