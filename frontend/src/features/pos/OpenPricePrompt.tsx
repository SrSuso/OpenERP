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

function normalise(value: string): string {
  return value.replace(',', '.');
}

/** Price entry for a deliberately configured open-price product. The amount
 * is the final amount the customer pays, never a client-side override for a
 * normal catalogue product. */
export function OpenPricePrompt({ product, onCancel, onConfirm, isPending }: OpenPricePromptProps) {
  const [value, setValue] = useState('');
  const parsed = Number(normalise(value));
  const isValid = /^\d+(?:[,.]\d{1,2})?$/.test(value) && Number.isFinite(parsed) && parsed > 0;

  function setAmount(next: string) {
    const cleaned = next.replace('.', ',').replace(/[^0-9,]/g, '');
    if (cleaned.split(',').length <= 2) setValue(cleaned);
  }

  function confirm() {
    if (!isValid || isPending) return;
    onConfirm(parsed.toFixed(2));
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
        <p className="mt-1 text-sm text-slate-400">Introduce el total indicado por el mostrador.</p>
        <label className="mt-4 block text-sm text-slate-300">
          Importe total
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            value={value}
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') confirm();
              if (event.key === 'Escape') onCancel();
            }}
            placeholder="0,00"
            className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-3 py-3 text-right text-3xl font-semibold text-slate-50"
          />
        </label>
        <p className="mt-2 text-right text-sm text-slate-300">
          Se añadirá:{' '}
          <span className="text-lg font-semibold text-emerald-400">
            {formatMoney(isValid ? parsed.toFixed(2) : '0')}
          </span>
        </p>
        <div className="mt-4">
          <Keypad
            value={value}
            onChange={setAmount}
            maxLength={8}
            allowDecimal
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
          className="mt-3 w-full rounded py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
