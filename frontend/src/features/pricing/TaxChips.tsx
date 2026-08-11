import { type Tax } from '@/features/pricing/api';
import { formatRate } from '@/lib/format';

interface TaxChipsProps {
  taxes: Tax[];
  selected: Set<number>;
  /** Recibe la selección resultante, de cero o un impuesto. */
  onChange: (next: Set<number>) => void;
}

/** Selector de impuestos como etiquetas pulsables (al estilo de los tags
 * de Odoo en el formulario de producto) — se usa tanto al dar de alta un
 * producto como al editar el precio de uno ya creado o el de una
 * categoría, siempre el mismo componente y el mismo gesto.
 *
 * Se elige uno como mucho: a un producto sólo le corresponde un tipo de
 * IVA, así que marcar otro sustituye al anterior en vez de sumarse. El
 * recargo de equivalencia no es uno de estos chips —viaja dentro del
 * propio impuesto, en su `surcharge_rate` (ver
 * `backend/app/pricing/models.py`)—, de modo que elegir un IVA ya trae el
 * recargo que le toca. Volver a pulsar el que está marcado lo desmarca:
 * sin ninguno, el producto hereda los de su categoría. */
export function TaxChips({ taxes, selected, onChange }: TaxChipsProps) {
  // Uno desactivado ya no cuenta en el cálculo (backend:
  // `effective_tax_rate`), así que ofrecerlo aquí sería mentir. Se sigue
  // mostrando si el producto ya lo tenía puesto, para no ocultar por qué
  // su precio es el que es.
  const selectable = taxes.filter((tax) => tax.is_active || selected.has(tax.id));

  if (selectable.length === 0) {
    return <span className="text-xs text-slate-400">No hay impuestos creados todavía.</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selectable.map((tax) => {
        const isSelected = selected.has(tax.id);
        return (
          <button
            key={tax.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(isSelected ? new Set() : new Set([tax.id]))}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              isSelected
                ? 'border-brand-700 bg-brand-700 text-white'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {tax.name} · {formatRate(tax.rate)}%
          </button>
        );
      })}
      <span className="w-full text-xs text-slate-400">
        Sólo se aplica un impuesto: al marcar otro se sustituye el anterior.
      </span>
    </div>
  );
}
