import { type KeyboardEvent } from 'react';

import { finalProductPrice, type Product } from '@/features/pos/api';
import { formatMoney } from '@/lib/format';

const KEY_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ñ'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
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
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Buscar productos"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
    >
      <div className="flex h-[calc(100dvh-2rem)] max-h-[54rem] w-full max-w-5xl flex-col rounded-xl bg-slate-800 p-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-50">Buscar producto</h2>
          <button
            type="button"
            onClick={onClose}
            className="pos-button-secondary rounded px-4 py-3 text-base font-medium"
          >
            Cerrar
          </button>
        </div>

        <label className="mt-3 block text-sm text-slate-300">
          Nombre, descripción, referencia o código
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

        <div className="my-3 min-h-0 flex-1 overflow-y-auto rounded border border-slate-700 bg-slate-900/50 p-2">
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
                  className="pos-button-secondary rounded px-4 py-4 text-left transition active:brightness-110 disabled:opacity-50"
                >
                  <span className="block text-lg font-semibold">{product.name}</span>
                  <span className="mt-1 block text-sm text-emerald-400">
                    {product.is_open_price
                      ? 'Precio libre'
                      : formatMoney(finalProductPrice(product))}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          className="shrink-0 rounded-xl border border-slate-600 bg-slate-950/50 p-3 shadow-inner"
          aria-label="Teclado para buscar productos"
        >
          <div className="space-y-2">
            {KEY_ROWS.map((row) => (
              <div key={row.join('')} className="flex justify-center gap-2">
                {row.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => pressKey(key)}
                    className="pos-button-secondary min-h-12 w-[clamp(2.5rem,7vw,4.5rem)] rounded-lg border border-slate-600 px-2 text-lg font-semibold shadow-sm transition active:translate-y-px active:brightness-110"
                  >
                    {key}
                  </button>
                ))}
              </div>
            ))}
            <div className="grid grid-cols-[1.4fr_1fr_2fr_1.4fr] gap-2">
              <button
                type="button"
                onClick={() => onQueryChange('')}
                className="pos-button-secondary min-h-12 rounded-lg border border-slate-600 px-2 text-sm font-semibold shadow-sm transition active:translate-y-px active:brightness-110"
              >
                Borrar todo
              </button>
              <button
                type="button"
                onClick={() => onQueryChange(query.slice(0, -1))}
                className="pos-button-secondary min-h-12 rounded-lg border border-slate-600 text-xl font-semibold shadow-sm transition active:translate-y-px active:brightness-110"
                aria-label="Borrar una letra"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => pressKey(' ')}
                className="pos-button-secondary min-h-12 rounded-lg border border-slate-600 px-2 text-sm font-semibold shadow-sm transition active:translate-y-px active:brightness-110"
              >
                Espacio
              </button>
              <button
                type="button"
                onClick={onClose}
                className="pos-button-primary min-h-12 rounded-lg px-2 text-sm font-semibold shadow-sm transition active:translate-y-px active:brightness-110"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
