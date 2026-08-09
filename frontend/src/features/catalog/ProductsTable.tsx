import { Link } from 'react-router';

import { type Product } from '@/features/catalog/api';
import { formatMoney } from '@/lib/format';

interface ProductsTableProps {
  products: Product[];
  canManage: boolean;
  onDeactivate: (id: number) => void;
  isDeactivating: boolean;
  onActivate: (id: number) => void;
  isActivating: boolean;
}

/** Cada fila enlaza a la ficha completa del producto
 * (`/admin/inventory/products/:id`, ver `ProductDetailPage`) — presentaciones,
 * precio, proveedores, lotes y compras se editan ahí, en pestañas, no desde
 * filas expandibles de esta tabla. */
export function ProductsTable({
  products,
  canManage,
  onDeactivate,
  isDeactivating,
  onActivate,
  isActivating,
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
            <th className="px-4 py-2 font-medium">Precio</th>
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
              <td className="px-4 py-2">{formatMoney(product.list_price)}</td>
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
