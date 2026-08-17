import { type KeyboardEvent } from 'react';

import { type Product } from '@/features/pos/api';
import { formatMoney } from '@/lib/format';

const KEY_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ñ'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '0', '1', '2', '3'],
  ['4', '5', '6', '7', '8', '9'],
] as const;

interface ProductSearchDialogProps {
  query: string;
  onQueryChange: (query: string) => void;
  products: Product[];
  isPending: boolean;
  isError: boolean;
  disabled: boolean;
  onPick: (product: Product) => void;
  onClose: () => void;
}

/** A large, self-contained product finder for a touch till. The regular
 * input remains a real field for a physical keyboard, but the on-screen
 * keys mean the cashier never has to summon a browser keyboard. */
export function ProductSearchDialog({
  query,
  onQueryChange,
  products,
  isPending,
  isError,
  disabled,
  onPick,
  onClose,
}: ProductSearchDialogProps) {
  const trimmed = query.trim();

  function pressKey(key: string) {
    onQueryChange(`${query}${key}`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      onClose();
    }
    if (event.key === 'Enter' && products.length === 1 && !disabled) {
      onPick(products[0]!);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Buscar productos"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
    >
      <div className="flex max-h-full w-full max-w-4xl flex-col rounded-xl bg-slate-800 p-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-50">Buscar producto</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-3 text-base font-medium text-slate-200 hover:bg-slate-700"
          >
            Cerrar
          </button>
        </div>

        <label className="mt-3 block text-sm text-slate-300">
          Nombre, referencia o código
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Toca las letras o escribe"
            className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-4 py-3 text-xl text-slate-50"
          />
        </label>

        <div className="my-3 min-h-0 overflow-y-auto rounded border border-slate-700 bg-slate-900/50 p-2">
          {trimmed === '' && (
            <p className="p-4 text-center text-slate-400">
              Escribe para buscar en todo el catálogo.
            </p>
          )}
          {trimmed !== '' && isPending && <p className="p-4 text-slate-400">Buscando productos…</p>}
          {trimmed !== '' && isError && (
            <p className="p-4 text-red-300">No se han podido buscar los productos.</p>
          )}
          {trimmed !== '' && !isPending && !isError && products.length === 0 && (
            <p className="p-4 text-slate-400">No hay productos que coincidan.</p>
          )}
          {trimmed !== '' && !isPending && !isError && products.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(product)}
                  className="rounded bg-slate-700 px-4 py-4 text-left text-slate-50 transition active:bg-slate-600 disabled:opacity-50"
                >
                  <span className="block text-lg font-semibold">{product.name}</span>
                  <span className="mt-1 block text-sm text-emerald-400">
                    {product.is_open_price ? 'Precio libre' : formatMoney(product.list_price)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2" aria-label="Teclado para buscar productos">
          {KEY_ROWS.map((row) => (
            <div key={row.join('')} className="flex justify-center gap-2">
              {row.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => pressKey(key)}
                  className="min-w-11 rounded bg-slate-700 px-3 py-3 text-lg font-semibold text-slate-50 transition active:bg-slate-600"
                >
                  {key}
                </button>
              ))}
            </div>
          ))}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => onQueryChange('')}
              className="rounded bg-slate-700 py-3 text-base font-semibold text-slate-50 active:bg-slate-600"
            >
              Borrar todo
            </button>
            <button
              type="button"
              onClick={() => onQueryChange(query.slice(0, -1))}
              className="rounded bg-slate-700 py-3 text-xl font-semibold text-slate-50 active:bg-slate-600"
              aria-label="Borrar una letra"
            >
              ←
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-till-600 py-3 text-base font-semibold text-white active:bg-till-500"
            >
              Listo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
