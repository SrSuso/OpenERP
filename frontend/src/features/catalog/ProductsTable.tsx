import { useState } from 'react';
import { Link } from 'react-router';

import { type Product } from '@/features/catalog/api';
import { decimalString } from '@/lib/decimal';
import { formatMoney } from '@/lib/format';

interface ProductsTableProps {
  products: Product[];
  canManage: boolean;
  canManagePricing: boolean;
  /** Unidades base cuyo precio se teclea en la propia fila (el resto sólo
   * lo muestra) — ver el ajuste `catalog.quick_price_units`. */
  quickPriceUnits: string[];
  onDeactivate: (id: number) => void;
  isDeactivating: boolean;
  onActivate: (id: number) => void;
  isActivating: boolean;
  /** Precio de venta tecleado en la propia fila — `listPrice` ya viene
   * normalizado (coma → punto) por `decimalString`. */
  onSetPrice: (id: number, listPrice: string) => void;
  savingPriceId: number | null;
  savedPriceId: number | null;
}

/** Cada fila enlaza a la ficha completa del producto
 * (`/admin/inventory/products/:id`, ver `ProductDetailPage`) — presentaciones,
 * precio, proveedores, lotes y compras se editan ahí, en pestañas, no desde
 * filas expandibles de esta tabla. */
export function ProductsTable({
  products,
  canManage,
  canManagePricing,
  quickPriceUnits,
  onDeactivate,
  isDeactivating,
  onActivate,
  isActivating,
  onSetPrice,
  savingPriceId,
  savedPriceId,
}: ProductsTableProps) {
  function confirmDeactivate(product: Product) {
    if (window.confirm(`¿Desactivar «${product.name}»? Dejará de venderse en el TPV.`)) {
      onDeactivate(product.id);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">SKU</th>
            <th className="px-4 py-2 font-medium">Nombre</th>
            <th className="px-4 py-2 font-medium">Categoría</th>
            <th className="px-4 py-2 font-medium">Categoría POS</th>
            <th className="px-4 py-2 font-medium">Precio (por unidad base)</th>
            <th className="px-4 py-2 font-medium">Estado</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2 font-mono text-xs text-slate-500">{product.sku}</td>
              <td className="px-4 py-2 font-medium text-slate-800">{product.name}</td>
              <td className="px-4 py-2">{product.category_name ?? '—'}</td>
              <td className="px-4 py-2">{product.pos_category_name ?? '—'}</td>
              <td className="px-4 py-2">
                {canManagePricing &&
                quickPriceUnits.includes(product.base_unit_name.toUpperCase()) ? (
                  <PriceCell
                    // Se remonta cuando el servidor devuelve otro precio, así
                    // el recuadro parte siempre de lo que hay guardado.
                    key={product.list_price}
                    product={product}
                    onSave={onSetPrice}
                    isSaving={savingPriceId === product.id}
                    isSaved={savedPriceId === product.id}
                  />
                ) : (
                  <>
                    {formatMoney(product.list_price)}
                    <span className="ml-1 text-xs text-slate-400">/{product.base_unit_name}</span>
                  </>
                )}
              </td>
              <td className="px-4 py-2">
                {product.is_active ? (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                    Activo
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                    Inactivo
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-right whitespace-nowrap">
                <Link
                  to={`/admin/inventory/products/${product.id}`}
                  className="mr-3 text-sm font-medium text-brand-700 hover:underline"
                >
                  Ver ficha
                </Link>
                {canManage && product.is_active && (
                  <button
                    type="button"
                    onClick={() => confirmDeactivate(product)}
                    disabled={isDeactivating}
                    className="text-sm font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Desactivar
                  </button>
                )}
                {canManage && !product.is_active && (
                  <button
                    type="button"
                    onClick={() => onActivate(product.id)}
                    disabled={isActivating}
                    className="text-sm font-medium text-brand-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Reactivar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `"1.680000"` (NUMERIC(18,6)) → `"1,68"`: lo que se teclearía, sin los
 * ceros de relleno y con la coma de aquí. */
function priceInputValue(listPrice: string): string {
  return String(Number(listPrice)).replace('.', ',');
}

/** El PVP tecleado en la propia fila, para poder repasar los precios del
 * día de un tirón (la fruta y la carne cambian a diario): Intro o salir del
 * recuadro guarda, Escape deshace. Fija el precio tal cual, sin pasar por el
 * margen ni la fórmula —eso es lo que hace `setManualPrice`—; para calcularlo
 * a partir del coste está la ficha del producto. */
function PriceCell({
  product,
  onSave,
  isSaving,
  isSaved,
}: {
  product: Product;
  onSave: (id: number, listPrice: string) => void;
  isSaving: boolean;
  isSaved: boolean;
}) {
  const saved = priceInputValue(product.list_price);
  const [draft, setDraft] = useState(saved);

  const parsed = decimalString({ min: 0 }).safeParse(draft);
  const isValid = parsed.success;

  function save() {
    if (!parsed.success || parsed.data === product.list_price) return;
    // Mismo número escrito de otra forma ("1,68" frente a "1.680000") no es
    // un cambio: guardarlo sólo ensuciaría el histórico de precios.
    if (Number(parsed.data) === Number(product.list_price)) return;
    onSave(product.id, parsed.data);
  }

  return (
    <span className="flex items-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        aria-label={`Precio de ${product.name}`}
        value={draft}
        disabled={isSaving}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') setDraft(saved);
        }}
        className={`w-20 rounded border px-2 py-1 text-right text-sm disabled:opacity-50 ${
          isValid ? 'border-slate-300' : 'border-red-400 bg-red-50'
        }`}
      />
      <span className="text-xs text-slate-400">€/{product.base_unit_name}</span>
      {isSaving && <span className="text-xs text-slate-400">Guardando…</span>}
      {!isSaving && isSaved && <span className="text-xs font-medium text-green-700">Guardado</span>}
    </span>
  );
}
