import { Link } from 'react-router';

import { type Product } from '@/features/catalog/api';
import { formatMoney, formatQuantity } from '@/lib/format';

interface ProductsTableProps {
  products: Product[];
  stockByProduct: Map<number, string> | null;
  lowStockProductIds: Set<number>;
}

export function ProductsTable({
  products,
  stockByProduct,
  lowStockProductIds,
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
                  {formatMoney(product.list_price)}
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
