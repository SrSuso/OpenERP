import { formatMoney, formatQuantity } from '@/lib/format';

interface PriceChangeDialogProps {
  productName: string;
  /** Qué se está cambiando — cambia sólo el texto, no el comportamiento. */
  what: 'PVP' | 'coste';
  current: string;
  next: string;
  /** Unidad base del producto ("KG", "UNIT"), para leer los importes. */
  unitName: string;
  /** Cuánto hay en almacén, o `null` si todavía no se sabe. */
  stock: string | null;
  /** Una línea más de explicación, cuando cambiar esto arrastra algo que
   * no se ve en el propio aviso (cambiar el coste recalcula el PVP). */
  note?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function percentChange(current: number, next: number): string | null {
  if (current === 0) return null;
  const change = ((next - current) / current) * 100;
  const rounded = Math.round(change);
  if (rounded === 0) return null;
  return `${rounded > 0 ? '+' : ''}${rounded} %`;
}

/** El aviso antes de cambiar un precio, con lo que hay en almacén delante.
 *
 * El precio es uno solo por producto: en cuanto se cambia, lo que ya está
 * en la estantería pasa a venderse al precio nuevo. Eso casi siempre es lo
 * que se quiere, pero no cuando el proveedor sube mucho y se prefiere
 * despachar antes lo comprado barato — y ese es justo el momento en que
 * uno se entera tarde. De ahí que se pregunte siempre, y que se enseñe
 * cuánto hay: sin stock la decisión no tiene ninguna importancia, y con
 * mucho la tiene toda. */
export function PriceChangeDialog({
  productName,
  what,
  current,
  next,
  unitName,
  stock,
  note,
  onConfirm,
  onCancel,
  isPending,
}: PriceChangeDialogProps) {
  const change = percentChange(Number(current), Number(next));
  const hasStock = stock !== null && Number(stock) > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Cambiar el ${what} de ${productName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-800">
          Vas a cambiar el {what} de «{productName}»
        </h2>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-500">Ahora</dt>
          <dd className="text-slate-800">
            {formatMoney(current)}/{unitName}
          </dd>
          <dt className="text-slate-500">Nuevo</dt>
          <dd className="font-semibold text-slate-900">
            {formatMoney(next)}/{unitName}
            {change && <span className="ml-2 font-normal text-amber-700">{change}</span>}
          </dd>
        </dl>

        {note && <p className="mt-4 text-sm text-slate-600">{note}</p>}

        <p className="mt-4 text-sm text-slate-600">
          {stock === null
            ? 'No se ha podido consultar el stock de este producto.'
            : hasStock
              ? `Tienes ${formatQuantity(stock)} ${unitName} en almacén. A partir de ahora se venderán al precio nuevo.`
              : 'No te queda nada en almacén de este producto.'}
        </p>

        {hasStock && (
          <p className="mt-2 text-sm text-slate-500">
            Si prefieres vender lo que tienes al precio de ahora, cancela y cámbialo cuando se
            acabe.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            autoFocus
            disabled={isPending}
            onClick={onConfirm}
            className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isPending ? 'Cambiando…' : 'Cambiar'}
          </button>
        </div>
      </div>
    </div>
  );
}
