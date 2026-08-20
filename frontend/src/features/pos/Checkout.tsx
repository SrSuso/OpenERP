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

/**
 * The payment step: choose the method first. Cash then opens its own
 * amount prompt, where an empty amount deliberately means exact payment;
 * card and other methods are always exact and need no numeric entry.
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
  const [cashPromptOpen, setCashPromptOpen] = useState(false);
  // El teclado recibe céntimos: 1250 siempre significa 12,50 €, sin tener
  // que buscar una coma en una pantalla táctil. Vacío sigue significando
  // «el cliente da el importe justo».
  const [tenderedCents, setTenderedCents] = useState('');

  const total = Number(sale.total);
  const tenderedIsEmpty = tenderedCents === '';
  const enteredTenderedAmount = Number(tenderedCents) / 100;
  const isTenderedValid =
    tenderedIsEmpty || (Number.isFinite(enteredTenderedAmount) && Number(tenderedCents) > 0);
  const tenderedAmount = tenderedIsEmpty ? total : enteredTenderedAmount;
  const change = !tenderedIsEmpty && isTenderedValid ? Math.max(0, tenderedAmount - total) : 0;
  const coversTotal = isTenderedValid && tenderedAmount >= total;

  function selectMethod(next: PaymentMethod) {
    setMethod(next);
    if (next === 'CASH') {
      setTenderedCents('');
      setCashPromptOpen(true);
    } else {
      setCashPromptOpen(false);
    }
  }

  function handleConfirm() {
    if (method === 'CASH') {
      setCashPromptOpen(true);
      return;
    }
    onConfirm([{ method, amount: total.toFixed(2) }]);
  }

  function confirmCash() {
    if (!coversTotal) return;
    onConfirm([{ method: 'CASH', amount: tenderedAmount.toFixed(2) }]);
  }

  function setCentsInput(next: string) {
    const digits = next.replace(/\D/g, '');
    if (digits.length <= 8) setTenderedCents(digits);
  }

  function handleTenderedKey(key: string) {
    if (/^\d$/.test(key)) setCentsInput(tenderedCents + key);
    if (key === 'Backspace') setTenderedCents(tenderedCents.slice(0, -1));
  }

  return (
    <div className="relative flex h-full w-full max-w-sm flex-col border-l border-slate-700 bg-slate-800/50">
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <h2 className="text-lg font-semibold">Cobrar</h2>
        <button
          type="button"
          onClick={() => {
            if (cashPromptOpen) {
              setCashPromptOpen(false);
              return;
            }
            onBack();
          }}
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
              aria-pressed={method === value}
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
          disabled={isPending}
          className="w-full rounded-lg bg-till-600 py-3 text-base font-semibold text-white transition hover:bg-till-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'Cobrando…' : 'Confirmar cobro'}
        </button>
      </div>

      {cashPromptOpen && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/75 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="cash-prompt-title"
            className="w-full max-w-sm rounded-xl border border-slate-600 bg-slate-800 p-4 shadow-2xl"
          >
            <h3 id="cash-prompt-title" className="text-lg font-semibold text-slate-50">
              Importe recibido
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              Introduce céntimos sin coma: 1250 equivale a 12,50 €. Déjalo vacío si el cliente
              entrega justo {formatMoney(sale.total)}.
            </p>
            <input
              id="tendered-amount"
              aria-label="Importe recibido"
              type="text"
              inputMode="numeric"
              autoFocus
              readOnly
              value={formatMoney(tenderedIsEmpty ? '0' : tenderedAmount.toFixed(2))}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setCashPromptOpen(false);
                  return;
                }
                if (/^\d$/.test(event.key) || event.key === 'Backspace') {
                  event.preventDefault();
                  handleTenderedKey(event.key);
                }
              }}
              aria-describedby="tendered-cents-help"
              disabled={isPending}
              className="mt-4 w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-right text-3xl font-semibold text-slate-50 disabled:opacity-60"
            />
            <p id="tendered-cents-help" className="mt-1 text-right text-xs text-slate-400">
              {tenderedCents || '0'} céntimos
            </p>
            {!coversTotal && (
              <p className="mt-1 text-sm text-red-400">El importe no cubre el total.</p>
            )}

            <div className="mt-4" aria-label="Teclado numérico para efectivo">
              <Keypad value={tenderedCents} onChange={setCentsInput} maxLength={8} />
            </div>

            {change > 0 && (
              <div className="mt-4 rounded-lg bg-slate-700 p-3 text-center">
                <p className="text-sm text-slate-300">Cambio</p>
                <p className="text-xl font-semibold text-slate-50">
                  {formatMoney(change.toFixed(6))}
                </p>
              </div>
            )}

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setCashPromptOpen(false)}
                disabled={isPending}
                className="flex-1 rounded border border-slate-500 py-2.5 text-sm font-medium text-slate-100 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmCash}
                disabled={isPending || !coversTotal}
                className="flex-1 rounded bg-till-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isPending ? 'Cobrando…' : 'Confirmar efectivo'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
