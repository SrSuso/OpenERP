const VARIABLES: { name: string; description: string }[] = [
  {
    name: 'cost',
    description:
      'El coste del producto — el que se fijó al crearlo, o el que tenga en su panel «Precio» si se cambió después.',
  },
  {
    name: 'tax_rate',
    description:
      'La suma de las tasas de los impuestos que apliquen al producto: los suyos propios si tiene alguno elegido, y si no, los de su categoría. Es un número de porcentaje tal cual (21 significa 21%, no 0,21).',
  },
  {
    name: 'margin_rate',
    description:
      'El margen efectivo del producto: el suyo propio si lo tiene fijado, si no el de su categoría, si no 0. Mismo formato que tax_rate (20 = 20%).',
  },
  {
    name: 'margin_amount',
    description:
      'El margen en dinero, no en porcentaje: los euros que se quieren ganar por unidad. El suyo propio si lo tiene fijado, si no el de su categoría, si no 0. En la fórmula de fábrica se suma al final, así que es lo que queda limpio con cada unidad.',
  },
  {
    name: 'surcharge_rate',
    description:
      'El recargo de equivalencia que acompaña a los impuestos aplicados (se configura junto a cada impuesto, en la lista de arriba: 5,2 con IVA 21, 1,4 con IVA 10, 0,5 con IVA 4). Es coste de compra —lo pagas tú al proveedor—, así que entra en el precio pero nunca se le repercute al cliente ni sale en el ticket. Vale 0 si no estás en ese régimen.',
  },
];

const FUNCTIONS: { call: string; description: string }[] = [
  { call: 'round(x)', description: 'redondea al entero más cercano.' },
  { call: 'ceil(x)', description: 'redondea siempre hacia arriba.' },
  { call: 'floor(x)', description: 'redondea siempre hacia abajo.' },
];

/** Cuadro de ayuda con todas las variables/funciones que puede usar una
 * fórmula de PVP — pedido explícitamente en vez de dejarlo en una sola
 * línea de texto. Mismo motor restringido desde la fase 4
 * (backend/app/pricing/formula.py, regla 12: nunca eval()) — sólo suma,
 * resta, multiplicación, división, paréntesis y las tres funciones de
 * aquí; cualquier otra cosa (acceder a un atributo, comparar, llamar a
 * algo que no esté en esta lista...) se rechaza antes de calcular nada. */
export function FormulaHelp() {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      <h4 className="mb-2 font-semibold text-slate-700">Variables disponibles</h4>
      <dl className="mb-4 grid gap-x-4 gap-y-2 sm:grid-cols-[max-content_1fr]">
        {VARIABLES.map((variable) => (
          <div key={variable.name} className="contents">
            <dt className="font-mono text-brand-700">{variable.name}</dt>
            <dd className="text-slate-600">{variable.description}</dd>
          </div>
        ))}
      </dl>

      <h4 className="mb-2 font-semibold text-slate-700">Funciones</h4>
      <dl className="mb-4 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
        {FUNCTIONS.map((fn) => (
          <div key={fn.call} className="contents">
            <dt className="font-mono text-brand-700">{fn.call}</dt>
            <dd className="text-slate-600">{fn.description}</dd>
          </div>
        ))}
      </dl>

      <h4 className="mb-1 font-semibold text-slate-700">Ejemplo (la fórmula de fábrica)</h4>
      <p className="mb-1 rounded bg-white px-2 py-1.5 font-mono text-xs text-slate-700">
        (cost + cost * tax_rate / 100 + cost * surcharge_rate / 100) * (1 + margin_rate / 100) +
        margin_amount
      </p>
      <p className="text-xs text-slate-500">
        Coste más impuestos y recargo, con el margen aplicado al final sobre ese total y, después,
        el margen fijo en euros. Con coste 10€, IVA 21% y margen 20%: (10 + 2,1) × 1,2 = 14,52€; si
        además se le ponen 25 céntimos fijos, 14,77€.
      </p>
    </div>
  );
}
