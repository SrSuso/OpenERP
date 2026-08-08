import { type Sale, type SaleLine } from '@/features/pos/api';
import { formatMoney, formatQuantity } from '@/lib/format';

interface CartProps {
  sale: Sale | null;
  /** Disables every mutation button while one is in flight, so a double tap
   * cannot fire two requests against the same line/sale. */
  disabled?: boolean;
  onRemoveLine: (line: SaleLine) => void;
  onCancelSale: () => void;
  onCheckout: () => void;
}

/**
 * The running ticket: lines already added to the open `DRAFT` sale (phase
 * 11's cart), a running total, and the means to remove a line, abandon the
 * whole sale, or move on to payment (phase 13's `Checkout`, rendered by
 * `PosHomePage` in place of this component once **Cobrar** is tapped).
 */
export function Cart({ sale, disabled, onRemoveLine, onCancelSale, onCheckout }: CartProps) {
  const lines = sale?.lines ?? [];

  return (
    <aside className="flex h-full w-full max-w-sm flex-col border-l border-slate-700 bg-slate-800/50">
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <h2 className="text-lg font-semibold">Venta actual</h2>
        <button
          type="button"
          onClick={onCancelSale}
          disabled={disabled || sale === null}
          className="rounded px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancelar venta
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">
            El carrito está vacío. Toca un producto para añadirlo.
          </p>
        ) : (
          <ul className="divide-y divide-slate-700">
            {lines.map((line) => (
              <li key={line.id} className="flex items-start justify-between gap-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-50">{line.product_name}</p>
                  <p className="text-xs text-slate-400">
                    {formatQuantity(line.quantity_packages)} × {line.package_name} ·{' '}
                    {formatMoney(line.unit_price)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-semibold text-slate-50">
                    {formatMoney(line.total)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Quitar ${line.product_name}`}
                    onClick={() => onRemoveLine(line)}
                    disabled={disabled}
                    className="rounded px-2 py-1 text-sm text-slate-400 hover:bg-slate-700 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-slate-700 p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-sm text-slate-300">Total</span>
          <span className="text-2xl font-bold text-emerald-400">
            {formatMoney(sale?.total ?? '0')}
          </span>
        </div>
        <button
          type="button"
          onClick={onCheckout}
          disabled={disabled || lines.length === 0}
          className="w-full rounded-lg bg-emerald-600 py-3 text-base font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cobrar
        </button>
      </div>
    </aside>
  );
}
