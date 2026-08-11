import { useQuery } from '@tanstack/react-query';

import { imageUrl, imageVersionsQuery } from '@/features/images/api';
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
  // Qué productos tienen foto, de una vez para toda la cuadrícula: así el
  // que no tiene no provoca una petición que acabe en 404.
  const versions = useQuery(imageVersionsQuery('product'));

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
    // El doble de columnas y menos alto que antes: en una caja caben más
    // productos por pantalla y se rebusca menos.
    <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-4 gap-2 overflow-y-auto p-3 sm:grid-cols-6 lg:grid-cols-8">
      {products.map((product) => (
        <ProductButton
          key={product.id}
          product={product}
          version={versions.data?.[String(product.id)]}
          disabled={disabled}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

/** Con foto el botón es un mosaico —se localiza el producto de un vistazo,
 * que es de lo que va una caja— y sin ella se queda como estaba, en vez de
 * dejar un hueco gris pidiendo una foto que quizá nunca se ponga. */
function ProductButton({
  product,
  version,
  disabled,
  onPick,
}: {
  product: Product;
  version: number | undefined;
  disabled: boolean | undefined;
  onPick: (product: Product) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(product)}
      className="flex h-24 flex-col justify-between overflow-hidden rounded-lg bg-slate-800 text-left shadow transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {version !== undefined && (
        <img
          src={imageUrl('product', product.id, version)}
          alt=""
          className="h-10 w-full shrink-0 object-cover"
        />
      )}
      <span className="line-clamp-2 px-2 pt-1.5 text-xs font-medium text-slate-50">
        {product.name}
      </span>
      <span className="px-2 pb-2 text-sm font-semibold text-emerald-400">
        {formatMoney(product.list_price)}
      </span>
    </button>
  );
}
