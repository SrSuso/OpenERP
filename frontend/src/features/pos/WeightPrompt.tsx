import { useState } from 'react';

import { Keypad } from '@/features/pos/Keypad';
import { type Product } from '@/features/pos/api';
import { formatMoney } from '@/lib/format';

interface WeightPromptProps {
  product: Product;
  onCancel: () => void;
  /** `quantity` en la unidad base del producto (kilos), ya convertido de
   * los gramos que se teclean. */
  onConfirm: (quantity: string) => void;
  isPending: boolean;
}

/** Los gramos se teclean; el kilo es lo que se cobra. Seis decimales es lo
 * que aguanta un `NUMERIC(18,6)`, y con gramos enteros nunca se llega. */
function gramsToKilos(grams: number): string {
  return (grams / 1000).toFixed(3);
}

/** Lo que sale al pulsar un producto que se vende pesando: nadie compra
 * exactamente un kilo de tomates, así que el toque no puede vender "1" a
 * secas. Se teclean los gramos que marca la balanza y se ve el importe
 * antes de aceptar, que es lo que se le va a cobrar al cliente. */
export function WeightPrompt({ product, onCancel, onConfirm, isPending }: WeightPromptProps) {
  const [grams, setGrams] = useState('');

  const parsed = Number(grams.replace(',', '.'));
  const isValid = grams.trim() !== '' && Number.isFinite(parsed) && parsed > 0;
  const amount = isValid ? (parsed / 1000) * Number(product.list_price) : 0;

  function confirm() {
    if (!isValid || isPending) return;
    onConfirm(gramsToKilos(parsed));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Cantidad de ${product.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
    >
      <div className="w-full max-w-sm rounded-lg bg-slate-800 p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-50">{product.name}</h2>
        <p className="mt-1 text-sm text-slate-400">
          {formatMoney(product.list_price)} / {product.base_unit_name}
        </p>

        {/* Se teclea con el teclado de abajo, pero sigue siendo un campo
            de verdad: quien tenga teclado físico (o un lector de balanza que
            escriba) no tiene por qué pulsar los botones. */}
        <label className="mt-4 block text-sm text-slate-300">
          Gramos
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={grams}
            onChange={(event) => setGrams(event.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') confirm();
              if (event.key === 'Escape') onCancel();
            }}
            placeholder="500"
            className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-3 py-3 text-right text-3xl font-semibold text-slate-50"
          />
        </label>

        <p className="mt-2 text-right text-sm text-slate-300">
          Importe:{' '}
          <span className="text-lg font-semibold text-emerald-400">
            {formatMoney(amount.toFixed(2))}
          </span>
        </p>

        <div className="mt-4">
          <Keypad
            value={grams}
            onChange={setGrams}
            maxLength={5}
            action={{
              label: isPending ? 'Añadiendo…' : 'Añadir',
              onPress: confirm,
              disabled: !isValid || isPending,
            }}
          />
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="mt-2 w-full rounded px-4 py-3 text-base font-medium text-slate-300 hover:bg-slate-700"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
