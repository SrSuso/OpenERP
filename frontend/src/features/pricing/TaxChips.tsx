import { type Tax } from '@/features/pricing/api';
import { formatRate } from '@/lib/format';

interface TaxChipsProps {
  taxes: Tax[];
  /** `null` = ninguno elegido. */
  selected: number | null;
  onSelect: (id: number | null) => void;
}

/** Selector del impuesto, como etiquetas pulsables (al estilo de los tags
 * de Odoo en el formulario de producto) — se usa al dar de alta un
 * producto, al editar su precio y al fijar el de una categoría, siempre el
 * mismo componente y el mismo gesto.
 *
 * **Uno como mucho**: un producto tiene un tipo de IVA, no dos sumados.
 * Antes se podían apilar varios porque así se representaba "IVA + recargo
 * de equivalencia"; desde que el recargo es una columna del propio
 * impuesto (`Tax.surcharge_rate`) apilar ya no hace falta, y permitirlo
 * sólo servía para calcular un IVA imposible del 31%. Volver a pulsar el
 * que ya está marcado lo quita, que es lo que devuelve a "hereda el de su
 * categoría". */
export function TaxChips({ taxes, selected, onSelect }: TaxChipsProps) {
  const selectable = taxes.filter((tax) => tax.is_active || tax.id === selected);

  if (selectable.length === 0) {
    return <span className="text-xs text-slate-400">No hay impuestos creados todavía.</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {selectable.map((tax) => {
        const isSelected = selected === tax.id;
        return (
          <button
            key={tax.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(isSelected ? null : tax.id)}
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
