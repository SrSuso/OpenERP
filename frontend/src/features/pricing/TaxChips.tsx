import { type Tax } from '@/features/pricing/api';
import { formatRate } from '@/lib/format';

interface TaxChipsProps {
  taxes: Tax[];
  selected: Set<number>;
  onToggle: (id: number) => void;
}

/** Selector de impuestos como etiquetas pulsables (al estilo de los tags
 * de Odoo en el formulario de producto) — se usa tanto al dar de alta un
 * producto como al editar el precio de uno ya creado o el de una
 * categoría, siempre el mismo componente y el mismo gesto. */
export function TaxChips({ taxes, selected, onToggle }: TaxChipsProps) {
  if (taxes.length === 0) {
    return <span className="text-xs text-slate-400">No hay impuestos creados todavía.</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {taxes.map((tax) => {
        const isSelected = selected.has(tax.id);
        return (
          <button
            key={tax.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onToggle(tax.id)}
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
    </div>
  );
}
