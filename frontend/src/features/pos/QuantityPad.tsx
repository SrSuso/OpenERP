import { Keypad } from '@/features/pos/Keypad';

interface QuantityPadProps {
  /** Vacío = una unidad, que es el caso de siempre. */
  value: string;
  onChange: (value: string) => void;
}

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
    <div className="w-56 shrink-0 border-t border-slate-700 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-slate-400">
          Cantidad para el siguiente
        </span>
        <output
          aria-label="Cantidad para el siguiente producto"
          className={`text-2xl font-semibold ${
            quantity === 1 ? 'text-slate-500' : 'text-amber-400'
          }`}
        >
          ×{quantity}
        </output>
      </div>
      <Keypad value={value} onChange={onChange} maxLength={3} />
    </div>
  );
}
