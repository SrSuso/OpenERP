import { Keypad } from '@/features/pos/Keypad';

interface QuantityPadProps {
  /** Vacío = una unidad, que es el caso de siempre. */
  value: string;
  onChange: (value: string) => void;
}

const QUICK_QUANTITIES = ['1', '2', '3', '5', '10'];

/** «Tres de éstos»: se teclea 3 y se pulsa el producto, que es como se ha
 * trabajado siempre en una caja — más rápido que pulsarlo tres veces y
 * mucho más que corregirlo luego en el carrito.
 *
 * Vale sólo para lo que se vende por unidades. Lo que se vende al peso
 * pregunta los gramos al pulsarlo (ver `WeightPrompt`), y ahí el
 * multiplicador no pinta nada: se ignora y se queda como estaba. */
export function QuantityPad({ value, onChange }: QuantityPadProps) {
  const quantity = value === '' ? 1 : Number(value);

  return (
    <div className="flex w-full shrink-0 border-b border-slate-700">
      <div className="w-56 shrink-0 border-r border-slate-700 p-3">
        <Keypad value={value} onChange={onChange} maxLength={3} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-4 p-4">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm font-medium text-slate-300">
            Cantidad para el siguiente artículo
          </span>
          <output
            aria-label="Cantidad para el siguiente producto"
            className={`text-4xl font-semibold ${
              quantity === 1 ? 'text-slate-400' : 'text-amber-400'
            }`}
          >
            ×{quantity}
          </output>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {QUICK_QUANTITIES.map((quickQuantity) => {
            const isSelected = quantity === Number(quickQuantity);
            return (
              <button
                key={quickQuantity}
                type="button"
                onClick={() => onChange(quickQuantity === '1' ? '' : quickQuantity)}
                className={`rounded py-3 text-lg font-semibold transition active:brightness-110 ${
                  isSelected
                    ? 'bg-amber-400 text-slate-950'
                    : 'bg-slate-700 text-slate-50 hover:bg-slate-600'
                }`}
              >
                ×{quickQuantity}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
