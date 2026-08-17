import { useState } from 'react';

import { type PaymentMethod, type Sale, type Tender } from '@/features/pos/api';
import { Keypad } from '@/features/pos/Keypad';
import { useShopFlag, useShopSetting } from '@/features/settings/useShopSettings';
import { formatMoney } from '@/lib/format';

interface CheckoutProps {
  sale: Sale;
  isPending: boolean;
  error: string | null;
  onConfirm: (payments: Tender[]) => void;
  onBack: () => void;
}

/** `sale.total` as a plain editable decimal string (`"36.30"`), not the
 * localised `formatMoney` output — this is what the cashier edits and what
 * gets sent back to the API. */
function totalAsInput(sale: Sale): string {
  return Number(sale.total).toFixed(2);
}

/**
 * The payment step (phase 13): pick cash or card, confirm (or edit, for
 * cash) the amount tendered, and check out — the same `DRAFT` sale phase
 * 11/12 built. A card tender is always exact (no change on a card); cash
 * can be typed as whatever the customer handed over, and change is
 * previewed live from it.
 */
export function Checkout({ sale, isPending, error, onConfirm, onBack }: CheckoutProps) {
  // Configurables por la tienda (app.settings.registry): con qué forma de
  // pago arranca la caja y si el tercer botón está a la vista. El nombre de
  // ese tercero también es suyo — "Bizum", "Vale"…
  const defaultMethod = useShopSetting('pos.default_payment_method', 'CASH') as PaymentMethod;
  const showOther = useShopFlag('pos.show_other_payment', false);
  const cashLabel = useShopSetting('ticket.label_cash', 'Efectivo');
  const cardLabel = useShopSetting('ticket.label_card', 'Tarjeta');
  const otherLabel = useShopSetting('ticket.label_other', 'Otro');

  const [method, setMethod] = useState<PaymentMethod>(defaultMethod);
  const [tendered, setTendered] = useState(() => totalAsInput(sale));
  // El total exacto se enseña de entrada para poder cobrarlo de un toque.
  // Si el cliente entrega otra cantidad, el primer dígito del teclado lo
  // sustituye, en lugar de convertir por ejemplo 12,50 € en 12,505 €.
  const [tenderedIsDefault, setTenderedIsDefault] = useState(true);

  const total = Number(sale.total);
  const tenderedAmount = Number(tendered.replace(',', '.'));
  const isTenderedValid = Number.isFinite(tenderedAmount) && tenderedAmount > 0;
  const change = isTenderedValid ? Math.max(0, tenderedAmount - total) : 0;
  const coversTotal = isTenderedValid && tenderedAmount >= total;

  function selectMethod(next: PaymentMethod) {
    setMethod(next);
    // Sólo el efectivo admite entregar de más y devolver cambio.
    if (next !== 'CASH') {
      setTendered(totalAsInput(sale));
      setTenderedIsDefault(true);
    }
  }

  function handleConfirm() {
    if (!coversTotal) {
      return;
    }
    onConfirm([{ method, amount: tenderedAmount.toFixed(2) }]);
  }

  return (
    <div className="flex h-full w-full max-w-sm flex-col border-l border-slate-700 bg-slate-800/50">
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <h2 className="text-lg font-semibold">Cobrar</h2>
        <button
          type="button"
          onClick={onBack}
          disabled={isPending}
          className="rounded px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Volver
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        <div className="text-center">
          <p className="text-sm text-slate-400">Total a cobrar</p>
          <p className="text-3xl font-bold text-emerald-400">{formatMoney(sale.total)}</p>
        </div>

        <div className={`grid gap-3 ${showOther ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {(
            [
              ['CASH', cashLabel],
              ['CARD', cardLabel],
              ...(showOther ? ([['OTHER', otherLabel]] as const) : []),
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => selectMethod(value)}
              disabled={isPending}
              className={`rounded-lg py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                method === value
                  ? 'bg-till-600 text-white'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div>
          <label htmlFor="tendered-amount" className="mb-1 block text-sm text-slate-300">
            {method === 'CASH' ? 'Importe recibido' : 'Importe'}
          </label>
          <input
            id="tendered-amount"
            type="text"
            inputMode="decimal"
            value={tendered}
            onChange={(event) => {
              setTendered(event.target.value);
              setTenderedIsDefault(false);
            }}
            disabled={isPending || method === 'CARD'}
            className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-lg text-slate-50 disabled:opacity-60"
          />
          {!coversTotal && (
            <p className="mt-1 text-sm text-red-400">El importe no cubre el total.</p>
          )}
        </div>

        {method === 'CASH' && (
          <div aria-label="Teclado numérico para efectivo">
            <p className="mb-2 text-sm text-slate-300">Importe entregado</p>
            <Keypad
              value={tendered}
              onChange={(value) => {
                setTendered(value);
                setTenderedIsDefault(false);
              }}
              maxLength={8}
              allowDecimal
              clearOnFirstInput={tenderedIsDefault}
            />
          </div>
        )}

        {method === 'CASH' && change > 0 && (
          <div className="rounded-lg bg-slate-800 p-3 text-center">
            <p className="text-sm text-slate-400">Cambio</p>
            <p className="text-xl font-semibold text-slate-50">{formatMoney(change.toFixed(6))}</p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
      </div>

      <div className="border-t border-slate-700 p-4">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending || !coversTotal}
          className="w-full rounded-lg bg-till-600 py-3 text-base font-semibold text-white transition hover:bg-till-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'Cobrando…' : 'Confirmar cobro'}
        </button>
      </div>
    </div>
  );
}
