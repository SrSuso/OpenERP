import { Fragment, type ReactNode } from 'react';

import { type Product } from '@/features/catalog/api';
import { formatMoney } from '@/lib/format';

interface ProductsTableProps {
  products: Product[];
  canManage: boolean;
  expandedId: number | null;
  onToggleExpand: (id: number) => void;
  onEdit: (product: Product) => void;
  onDeactivate: (id: number) => void;
  isDeactivating: boolean;
  renderExpanded: (product: Product) => ReactNode;
}

export function ProductsTable({
  products,
  canManage,
  expandedId,
  onToggleExpand,
  onEdit,
  onDeactivate,
  isDeactivating,
  renderExpanded,
}: ProductsTableProps) {
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
            <Fragment key={product.id}>
              <tr className="border-b border-slate-100 last:border-0">
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
                  <button
                    type="button"
                    onClick={() => onToggleExpand(product.id)}
                    className="mr-3 text-sm font-medium text-slate-600 hover:underline"
                  >
                    {expandedId === product.id ? 'Ocultar' : 'Presentaciones'}
                  </button>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => onEdit(product)}
                        className="mr-3 text-sm font-medium text-brand-700 hover:underline"
                      >
                        Editar
                      </button>
                      {product.is_active && (
                        <button
                          type="button"
                          onClick={() => onDeactivate(product.id)}
                          disabled={isDeactivating}
                          className="text-sm font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Desactivar
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
              {expandedId === product.id && (
                <tr>
                  <td colSpan={7} className="p-0">
                    {renderExpanded(product)}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
