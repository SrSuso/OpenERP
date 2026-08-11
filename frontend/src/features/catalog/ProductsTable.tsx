import { useState } from 'react';
import { Link } from 'react-router';

import { type PosCategory, type Product } from '@/features/catalog/api';
import { decimalInputValue, decimalString } from '@/lib/decimal';
import { formatMoney, formatQuantity } from '@/lib/format';

interface ProductsTableProps {
  products: Product[];
  canManagePricing: boolean;
  /** Unidades base cuyo precio se teclea en la propia fila (el resto sólo
   * lo muestra) — ver el ajuste `catalog.quick_price_units`. */
  quickPriceUnits: string[];
  /** Cuánto hay de cada producto, por id. Ausente = todavía cargando, o
   * sin permiso para verlo (`inventory.read`). */
  stockByProduct: Map<number, string> | null;
  /** Para el desplegable de categoría POS de cada fila. */
  posCategories: PosCategory[];
  canManage: boolean;
  /** Cambia el botón del TPV al que pertenece el producto. `null` = lo
   * saca de todos. */
  onSetPosCategory: (product: Product, posCategoryId: number | null) => void;
  savingPosCategoryId: number | null;
  /** Precio de venta tecleado en la propia fila — `listPrice` ya viene
   * normalizado (coma → punto) por `decimalString`. No guarda: la página
   * pregunta antes, porque el precio nuevo se aplica también a lo que ya
   * está en la estantería (ver `PriceChangeDialog`). */
  onSetPrice: (product: Product, listPrice: string) => void;
  savingPriceId: number | null;
  savedPriceId: number | null;
}

/** El nombre de cada producto es el enlace a su ficha
 * (`/admin/inventory/products/:id`, ver `ProductDetailPage`), que es donde
 * se hace *todo* con él: datos generales, precio, presentaciones,
 * proveedores, lotes, y desactivarlo o reactivarlo. La lista no repite esas
 * acciones en cada fila; para eso está la ficha.
 *
 * El SKU no se enseña: es una referencia interna que genera el propio
 * programa para que ventas, compras e inventario se entiendan entre ellos,
 * y en una tienda pequeña no significa nada para quien mira la lista. Se
 * sigue pudiendo buscar por él. */
export function ProductsTable({
  products,
  canManagePricing,
  quickPriceUnits,
  stockByProduct,
  posCategories,
  canManage,
  onSetPosCategory,
  savingPosCategoryId,
  onSetPrice,
  savingPriceId,
  savedPriceId,
}: ProductsTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Producto</th>
            <th className="px-4 py-2 font-medium">Categoría</th>
            <th className="px-4 py-2 font-medium">Categoría POS</th>
            <th className="px-4 py-2 font-medium">Stock</th>
            <th className="px-4 py-2 font-medium">Precio (por unidad base)</th>
            <th className="px-4 py-2 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2">
                <Link
                  to={`/admin/inventory/products/${product.id}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  {product.name}
                </Link>
              </td>
              <td className="px-4 py-2">{product.category_name ?? '—'}</td>
              <td className="px-4 py-2">
                {canManage ? (
                  <select
                    aria-label={`Categoría POS de ${product.name}`}
                    value={product.pos_category_id ?? ''}
                    disabled={savingPosCategoryId === product.id}
                    onChange={(event) =>
                      onSetPosCategory(
                        product,
                        event.target.value === '' ? null : Number(event.target.value),
                      )
                    }
                    className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
                  >
                    <option value="">Sin categoría</option>
                    {/* Una oculta deja de ofrecerse, salvo que sea la que
                        este producto ya tenía: si no, parecería que no
                        tiene ninguna. */}
                    {posCategories
                      .filter(
                        (category) => category.is_active || category.id === product.pos_category_id,
                      )
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                  </select>
                ) : (
                  (product.pos_category_name ?? '—')
                )}
              </td>
              <td className="px-4 py-2 whitespace-nowrap">
                {stockByProduct === null ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <>
                    {/* Sin fila de saldo es que no hay ninguno, no que se
                        desconozca: el saldo se borra al llegar a cero. */}
                    {formatQuantity(stockByProduct.get(product.id) ?? '0')}
                    <span className="ml-1 text-xs text-slate-400">{product.base_unit_name}</span>
                  </>
                )}
              </td>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
  onSave: (product: Product, listPrice: string) => void;
  isSaving: boolean;
  isSaved: boolean;
}) {
  const saved = decimalInputValue(product.list_price);
  const [draft, setDraft] = useState(saved);

  const parsed = decimalString({ min: 0 }).safeParse(draft);
  const isValid = parsed.success;

  function save() {
    if (!parsed.success || parsed.data === product.list_price) return;
    // Mismo número escrito de otra forma ("1,68" frente a "1.680000") no es
    // un cambio: proponerlo sólo sacaría un aviso para nada.
    if (Number(parsed.data) === Number(product.list_price)) return;
    onSave(product, parsed.data);
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
