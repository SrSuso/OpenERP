import { useState } from 'react';

import { Keypad } from '@/features/pos/Keypad';
import { type Product } from '@/features/pos/api';
import { formatMoney } from '@/lib/format';

interface OpenPricePromptProps {
  product: Product;
  onCancel: () => void;
  onConfirm: (total: string) => void;
  isPending: boolean;
}

/** The POS keypad receives cents, not a locale-formatted decimal. Keeping the
 * raw digits separately means four taps (`1250`) always mean €12.50. */
function centsToAmount(cents: string): string {
  return (Number(cents || '0') / 100).toFixed(2);
}

/** Price entry for a deliberately configured open-price product. The amount
 * is the final amount the customer pays, never a client-side override for a
 * normal catalogue product. */
export function OpenPricePrompt({ product, onCancel, onConfirm, isPending }: OpenPricePromptProps) {
  const [cents, setRawCents] = useState('');
  const amount = centsToAmount(cents);
  const isValid = /^\d+$/.test(cents) && Number(cents) > 0;

  function setCentsInput(next: string) {
    const digits = next.replace(/\D/g, '');
    if (digits.length <= 8) setRawCents(digits);
  }

  function confirm() {
    if (!isValid || isPending) return;
    onConfirm(amount);
  }

  function handleKeyDown(key: string) {
    if (/^\d$/.test(key)) setCentsInput(cents + key);
    if (key === 'Backspace') setRawCents(cents.slice(0, -1));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Importe de ${product.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
    >
      <div className="w-full max-w-sm rounded-lg bg-slate-800 p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-50">{product.name}</h2>
        <p className="mt-1 text-sm text-slate-400">
          Introduce los céntimos sin coma: 1250 equivale a 12,50 €.
        </p>
        <label className="mt-4 block text-sm text-slate-300">
          Importe total
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            readOnly
            value={formatMoney(amount)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') confirm();
              if (event.key === 'Escape') onCancel();
              if (/^\d$/.test(event.key) || event.key === 'Backspace') {
                event.preventDefault();
                handleKeyDown(event.key);
              }
            }}
            aria-describedby="open-price-cents-help"
            className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-3 py-3 text-right text-3xl font-semibold text-slate-50"
          />
        </label>
        <p id="open-price-cents-help" className="mt-1 text-right text-xs text-slate-400">
          {cents || '0'} céntimos
        </p>
        <p className="mt-2 text-right text-sm text-slate-300">
          Se añadirá:{' '}
          <span className="text-lg font-semibold text-emerald-400">{formatMoney(amount)}</span>
        </p>
        <div className="mt-4">
          <Keypad
            value={cents}
            onChange={setCentsInput}
            maxLength={8}
            action={{
              label: isPending ? 'Añadiendo…' : 'Añadir al carrito',
              onPress: confirm,
              disabled: !isValid || isPending,
            }}
          />
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="pos-button-secondary mt-3 w-full rounded py-2 text-sm font-medium disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
