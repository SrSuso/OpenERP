import { type Sale } from '@/features/pos/api';
import { formatMoney } from '@/lib/format';

interface OpenSalesBarProps {
  sales: Sale[];
  activeId: number | null;
  onSelect: (sale: Sale) => void;
  onOpenNew: () => void;
  disabled: boolean;
}

/** Las ventas abiertas a la vez, para poder aparcar una y atender a otro.
 *
 * Pasa a diario: alguien se deja el pan, se va a por él y detrás hay tres
 * personas esperando. Cada una es una venta de verdad en el servidor (en
 * borrador), no algo guardado en esta pantalla, así que sobreviven a un
 * cierre del navegador y se pueden retomar desde otra caja.
 *
 * Con una sola abierta la barra no se enseña: no hay nada entre lo que
 * elegir y sólo quitaría sitio. */
export function OpenSalesBar({
  sales,
  activeId,
  onSelect,
  onOpenNew,
  disabled,
}: OpenSalesBarProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-700 px-3 py-2">
      {sales.length > 1 &&
        sales.map((sale, index) => {
          const isActive = sale.id === activeId;
          const lines = sale.lines.length;
          return (
            <button
              key={sale.id}
              type="button"
              aria-current={isActive}
              onClick={() => onSelect(sale)}
              className={`shrink-0 rounded px-3 py-1.5 text-left text-sm transition ${
                isActive
                  ? 'bg-slate-50 text-slate-900'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {/* Por su orden en la barra y no por su número interno: lo que
                  hay que reconocer es "la primera" y "la de después". */}
              <span className="font-medium">Venta {index + 1}</span>
              <span className={`ml-2 text-xs ${isActive ? 'text-slate-500' : 'text-slate-400'}`}>
                {lines === 0
                  ? 'vacía'
                  : `${lines} ${lines === 1 ? 'línea' : 'líneas'} · ${formatMoney(sale.total)}`}
              </span>
            </button>
          );
        })}

      <button
        type="button"
        disabled={disabled}
        onClick={onOpenNew}
        className="ml-auto shrink-0 rounded bg-slate-700 px-3 py-1.5 text-sm font-medium text-slate-50 hover:bg-slate-600 disabled:opacity-50"
      >
        + Venta nueva
      </button>
    </div>
  );
}
