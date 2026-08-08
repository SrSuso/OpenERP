import { type Product } from '@/features/pos/api';
import { formatMoney } from '@/lib/format';

interface ProductGridProps {
  products: Product[];
  isPending: boolean;
  isError: boolean;
  onPick: (product: Product) => void;
  /** Disables every button while a line is being added, so a double tap
   * cannot fire two mutations against the same sale. */
  disabled?: boolean;
}

/**
 * Touch-first grid of product buttons. A tap always sells one unit of the
 * product's base presentation — picking a different package/quantity is a
 * deliberate scope cut for phase 12 (see the phase report).
 */
export function ProductGrid({ products, isPending, isError, onPick, disabled }: ProductGridProps) {
  if (isPending) {
    return <p className="p-6 text-slate-400">Cargando productos…</p>;
  }
  if (isError) {
    return <p className="p-6 text-red-400">No se pudieron cargar los productos.</p>;
  }
  if (products.length === 0) {
    return <p className="p-6 text-slate-400">No hay productos en esta categoría.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 overflow-y-auto p-3 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <button
          key={product.id}
          type="button"
          disabled={disabled}
          onClick={() => onPick(product)}
          className="flex h-28 flex-col justify-between rounded-lg bg-slate-800 p-3 text-left shadow transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="line-clamp-2 text-sm font-medium text-slate-50">{product.name}</span>
          <span className="text-lg font-semibold text-emerald-400">
            {formatMoney(product.list_price)}
          </span>
        </button>
      ))}
    </div>
  );
}
