interface QuantityPadProps {
  /** Vacío = una unidad, que es el caso de siempre. */
  value: string;
  onChange: (value: string) => void;
}

const QUANTITIES = Array.from({ length: 10 }, (_, index) => String(index + 1));

/** «Tres de éstos»: se elige ×3 y se pulsa el producto, que es más rápido
 * que pulsarlo tres veces y mucho más que corregirlo luego en el carrito.
 *
 * Vale sólo para lo que se vende por unidades. Lo que se vende al peso
 * pregunta los gramos al pulsarlo (ver `WeightPrompt`), y ahí el
 * multiplicador no pinta nada: se ignora y se queda como estaba. */
export function QuantityPad({ value, onChange }: QuantityPadProps) {
  const quantity = value === '' ? 1 : Number(value);

  return (
    <div className="flex w-full shrink-0 items-center gap-4 border-b border-slate-700 p-3">
      <div className="flex shrink-0 items-baseline gap-3">
        <span className="text-sm font-medium text-slate-300">Cantidad siguiente</span>
        <output
          aria-label="Cantidad para el siguiente producto"
          className={`text-2xl font-semibold ${
            quantity === 1 ? 'text-slate-400' : 'text-amber-400'
          }`}
        >
          ×{quantity}
        </output>
      </div>
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
        {QUANTITIES.map((nextQuantity) => {
          const isSelected = quantity === Number(nextQuantity);
          return (
            <button
              key={nextQuantity}
              type="button"
              onClick={() => onChange(nextQuantity === '1' ? '' : nextQuantity)}
              className={`min-h-12 min-w-12 flex-1 rounded text-lg font-semibold transition active:brightness-110 ${
                isSelected
                  ? 'bg-amber-400 text-slate-950'
                  : 'bg-slate-700 text-slate-50 hover:bg-slate-600'
              }`}
            >
              ×{nextQuantity}
            </button>
          );
        })}
      </div>
    </div>
  );
}
