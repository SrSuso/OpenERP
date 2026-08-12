import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import { CreateSupplierForm } from '@/features/suppliers/CreateSupplierForm';
import { EditSupplierForm } from '@/features/suppliers/EditSupplierForm';
import { SuppliersTable } from '@/features/suppliers/SuppliersTable';
import {
  createSupplier,
  deactivateSupplier,
  suppliersQuery,
  updateSupplier,
  type Supplier,
  type SupplierCreateInput,
  type SupplierUpdateInput,
} from '@/features/suppliers/api';

import { pageHeaderRow, primaryAction } from './pageActions';

/** `/admin/suppliers` — gated by `supplier.read`; mutations gated by
 * `supplier.manage` (backend/app/rbac/permissions.py's phase 5). */
export function SuppliersPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('supplier.manage');

  const [showInactive, setShowInactive] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const suppliers = useQuery(suppliersQuery(!showInactive));
  const queryClient = useQueryClient();

  const invalidateSuppliers = () =>
    void queryClient.invalidateQueries({ queryKey: ['suppliers', 'list'] });

  const createMutation = useMutation({
    mutationFn: (payload: SupplierCreateInput) => createSupplier(payload),
    onSuccess: () => {
      invalidateSuppliers();
      setShowCreateForm(false);
      setCreateError(null);
    },
    onError: () => setCreateError('No se ha podido crear el proveedor.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: SupplierUpdateInput }) =>
      updateSupplier(id, payload),
    onSuccess: () => {
      invalidateSuppliers();
      setEditingSupplier(null);
      setEditError(null);
    },
    onError: () => setEditError('No se ha podido guardar el proveedor.'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => deactivateSupplier(id),
    onSuccess: invalidateSuppliers,
  });

  return (
    <section>
      <div className={pageHeaderRow}>
        <div>
          <h1 className="text-2xl font-semibold">Proveedores</h1>
          <label className="mt-2 flex items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
            />
            Incluir inactivos
          </label>
        </div>

        {canManage && !showCreateForm && (
          <button type="button" onClick={() => setShowCreateForm(true)} className={primaryAction}>
            Nuevo proveedor
          </button>
        )}
      </div>

      {showCreateForm && (
        <CreateSupplierForm
          isPending={createMutation.isPending}
          submitError={createError}
          onCancel={() => {
            setShowCreateForm(false);
            setCreateError(null);
          }}
          onSubmit={(payload) => createMutation.mutate(payload)}
        />
      )}

      {editingSupplier && (
        <EditSupplierForm
          supplier={editingSupplier}
          isPending={updateMutation.isPending}
          submitError={editError}
          onCancel={() => {
            setEditingSupplier(null);
            setEditError(null);
          }}
          onSubmit={(payload) => updateMutation.mutate({ id: editingSupplier.id, payload })}
        />
      )}

      {suppliers.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {suppliers.isError && (
        <p className="text-sm text-red-600">No se han podido cargar los proveedores.</p>
      )}

      {suppliers.data && (
        <SuppliersTable
          suppliers={suppliers.data}
          canManage={canManage}
          expandedId={expandedId}
          onToggleExpand={(id) => setExpandedId((current) => (current === id ? null : id))}
          onEdit={(supplier) => {
            setEditingSupplier(supplier);
            setEditError(null);
          }}
          onDeactivate={(id) => deactivateMutation.mutate(id)}
          isDeactivating={deactivateMutation.isPending}
        />
      )}
    </section>
  );
}
