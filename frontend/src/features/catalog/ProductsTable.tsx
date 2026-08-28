import { useState } from 'react';
import { Link } from 'react-router';

import { type Product } from '@/features/catalog/api';
import { decimalInputValue, decimalString } from '@/lib/decimal';
import { formatMoney, formatQuantity } from '@/lib/format';

interface ProductsTableProps {
  products: Product[];
  stockByProduct: Map<number, string> | null;
  lowStockProductIds: Set<number>;
  canManagePricing: boolean;
  quickPriceCategoryIds: Set<number>;
  onSetPrice: (product: Product, listPrice: string) => void;
  savingPriceId: number | null;
  savedPriceId: number | null;
  priceEditRevision: number;
}

export function ProductsTable({
  products,
  stockByProduct,
  lowStockProductIds,
  canManagePricing,
  quickPriceCategoryIds,
  onSetPrice,
  savingPriceId,
  savedPriceId,
  priceEditRevision,
}: ProductsTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-5 py-3">Producto</th>
            <th className="px-5 py-3">Categoría</th>
            <th className="px-5 py-3">PVP</th>
            <th className="px-5 py-3">Stock</th>
            <th className="px-5 py-3">Estado</th>
            <th className="px-5 py-3">Disponibilidad</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {products.map((product) => {
            const hasLowStock = lowStockProductIds.has(product.id);
            const canEditPrice =
              canManagePricing &&
              product.category_id !== null &&
              quickPriceCategoryIds.has(product.category_id);
            return (
              <tr key={product.id} className="hover:bg-brand-50/40">
                <td className="px-5 py-4">
                  <Link
                    to={`/admin/inventory/products/${product.id}`}
                    className="block rounded font-semibold text-slate-900 hover:text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    {product.name}
                  </Link>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {product.base_unit_name}
                    {product.pos_category_name ? ` · ${product.pos_category_name}` : ''}
                  </span>
                </td>
                <td className="px-5 py-4 text-slate-700">
                  {product.category_name ?? 'Sin categoría'}
                </td>
                <td className="px-5 py-4 font-semibold text-slate-900">
                  {canEditPrice ? (
                    <MoneyCell
                      key={`${product.list_price}-${priceEditRevision}`}
                      product={product}
                      value={product.list_price}
                      onSave={onSetPrice}
                      isSaving={savingPriceId === product.id}
                      isSaved={savedPriceId === product.id}
                    />
                  ) : (
                    <>
                      {formatMoney(product.list_price)}
                      <span className="ml-1 text-xs font-normal text-slate-500">
                        /{product.base_unit_name}
                      </span>
                    </>
                  )}
                </td>
                <td className="px-5 py-4 whitespace-nowrap text-slate-700">
                  {!product.effective_tracks_stock ? (
                    <span className="text-slate-500">Sin control</span>
                  ) : stockByProduct === null ? (
                    '—'
                  ) : (
                    `${formatQuantity(stockByProduct.get(product.id) ?? '0')} ${product.base_unit_name}`
                  )}
                </td>
                <td className="px-5 py-4">
                  {hasLowStock ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">
                      Stock bajo
                    </span>
                  ) : product.effective_tracks_stock ? (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                      Correcto
                    </span>
                  ) : (
                    <span className="text-sm text-slate-500">No aplica</span>
                  )}
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      product.is_active
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {product.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** El único campo editable de la tabla. Intro o perder el foco propone el
 * cambio; Escape restaura el PVP guardado. La confirmación y la escritura
 * real permanecen en ProductsPage, mediante PriceChangeDialog y
 * setManualPrice, igual que en main. */
function MoneyCell({
  product,
  value,
  onSave,
  isSaving,
  isSaved,
}: {
  product: Product;
  value: string;
  onSave: (product: Product, value: string) => void;
  isSaving: boolean;
  isSaved: boolean;
}) {
  const saved = decimalInputValue(value);
  const [draft, setDraft] = useState(saved);
  const parsed = decimalString({ min: 0 }).safeParse(draft);

  function propose() {
    if (!parsed.success || Number(parsed.data) === Number(value)) return;
    onSave(product, parsed.data);
  }

  return (
    <span className="flex min-w-max items-center gap-1.5">
      <input
        type="text"
        inputMode="decimal"
        aria-label={`PVP de venta de ${product.name}`}
        aria-invalid={!parsed.success}
        title={
          parsed.success ? 'Intro o salir del campo para revisar el cambio' : 'Precio no válido'
        }
        value={draft}
        disabled={isSaving}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={propose}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(saved);
          }
        }}
        className={`h-9 w-20 rounded-lg border px-2 text-right text-sm font-semibold outline-none focus:ring-2 disabled:opacity-60 ${
          parsed.success
            ? 'border-slate-300 bg-white focus:border-brand-500 focus:ring-brand-100'
            : 'border-red-400 bg-red-50 focus:ring-red-100'
        }`}
      />
      <span className="text-xs font-normal text-slate-500">€/{product.base_unit_name}</span>
      {isSaving && <span className="text-xs font-normal text-slate-500">Guardando…</span>}
      {!isSaving && isSaved && (
        <span className="text-xs font-semibold text-emerald-700">Guardado</span>
      )}
    </span>
  );
}
