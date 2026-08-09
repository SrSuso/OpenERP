import { Fragment } from 'react';

import { SupplierProductsPanel } from '@/features/suppliers/SupplierProductsPanel';
import { type Supplier } from '@/features/suppliers/api';

interface SuppliersTableProps {
  suppliers: Supplier[];
  canManage: boolean;
  expandedId: number | null;
  onToggleExpand: (id: number) => void;
  onEdit: (supplier: Supplier) => void;
  onDeactivate: (id: number) => void;
  isDeactivating: boolean;
}

export function SuppliersTable({
  suppliers,
  canManage,
  expandedId,
  onToggleExpand,
  onEdit,
  onDeactivate,
  isDeactivating,
}: SuppliersTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Nombre</th>
            <th className="px-4 py-2 font-medium">NIF/CIF</th>
            <th className="px-4 py-2 font-medium">Email</th>
            <th className="px-4 py-2 font-medium">Teléfono</th>
            <th className="px-4 py-2 font-medium">Estado</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {suppliers.map((supplier) => (
            <Fragment key={supplier.id}>
              <tr className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 font-medium text-slate-800">{supplier.name}</td>
                <td className="px-4 py-2">{supplier.tax_id ?? '—'}</td>
                <td className="px-4 py-2">{supplier.email ?? '—'}</td>
                <td className="px-4 py-2">{supplier.phone ?? '—'}</td>
                <td className="px-4 py-2">
                  {supplier.is_active ? (
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
                    onClick={() => onToggleExpand(supplier.id)}
                    className="mr-3 text-sm font-medium text-slate-600 hover:underline"
                  >
                    {expandedId === supplier.id ? 'Ocultar' : 'Productos'}
                  </button>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => onEdit(supplier)}
                        className="mr-3 text-sm font-medium text-brand-700 hover:underline"
                      >
                        Editar
                      </button>
                      {supplier.is_active && (
                        <button
                          type="button"
                          onClick={() => onDeactivate(supplier.id)}
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
              {expandedId === supplier.id && (
                <tr>
                  <td colSpan={6} className="p-0">
                    <SupplierProductsPanel supplierId={supplier.id} canManage={canManage} />
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
