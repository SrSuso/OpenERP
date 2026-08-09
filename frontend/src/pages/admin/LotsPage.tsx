import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import { productsQuery } from '@/features/catalog/api';
import { CreateLotForm } from '@/features/lots/CreateLotForm';
import { LotBalancesPanel } from '@/features/lots/LotBalancesPanel';
import { LotsTable } from '@/features/lots/LotsTable';
import { createLot, lotsQuery, type LotCreateInput } from '@/features/lots/api';
import { suppliersQuery } from '@/features/suppliers/api';

/** `/admin/lots` — gated by `lot.read`; crear lotes y consumir stock por
 * FEFO necesita `lot.manage` (backend/app/rbac/permissions.py's fase 8). */
export function LotsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('lot.manage');

  const [productId, setProductId] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const products = useQuery(productsQuery({ activeOnly: true }));
  const suppliers = useQuery(suppliersQuery(true));
  const lots = useQuery({
    ...lotsQuery(productId === '' ? null : Number(productId)),
    enabled: productId !== '',
  });
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (payload: LotCreateInput) => createLot(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lots', 'list', Number(productId)] });
      setCreateError(null);
    },
    onError: () => setCreateError('No se ha podido crear el lote.'),
  });

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">Lotes y caducidad</h1>

      <label className="mb-4 block text-sm text-slate-600">
        Producto
        <select
          value={productId}
          onChange={(event) => setProductId(event.target.value)}
          className="mt-1 block w-64 rounded border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Elige un producto…</option>
          {(products.data ?? []).map((product) => (
            <option key={product.id} value={product.id}>
              {product.sku} — {product.name}
              {product.track_lots ? '' : ' (no controla lotes)'}
            </option>
          ))}
        </select>
      </label>

      {productId === '' && (
        <p className="text-sm text-slate-500">Elige un producto para ver y gestionar sus lotes.</p>
      )}

      {productId !== '' && (
        <div className="space-y-4">
          {canManage && (
            <CreateLotForm
              productId={Number(productId)}
              suppliers={suppliers.data ?? []}
              isPending={createMutation.isPending}
              submitError={createError}
              onSubmit={(payload) => createMutation.mutate(payload)}
            />
          )}

          {lots.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
          {lots.isError && (
            <p className="text-sm text-red-600">No se han podido cargar los lotes.</p>
          )}
          {lots.data && <LotsTable lots={lots.data} />}

          <LotBalancesPanel productId={Number(productId)} canManage={canManage} />
        </div>
      )}
    </section>
  );
}
