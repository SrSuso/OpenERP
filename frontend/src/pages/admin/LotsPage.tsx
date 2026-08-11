import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import { productsQuery } from '@/features/catalog/api';
import { useProductSearch } from '@/features/catalog/useProductSearch';
import { CreateLotForm } from '@/features/lots/CreateLotForm';
import { LotBalancesPanel } from '@/features/lots/LotBalancesPanel';
import { LotsTable } from '@/features/lots/LotsTable';
import { createLot, lotsQuery, type LotCreateInput } from '@/features/lots/api';
import { suppliersQuery } from '@/features/suppliers/api';

/** `/admin/inventory/lots` — gated by `lot.read`; crear lotes y consumir stock por
 * FEFO necesita `lot.manage` (backend/app/rbac/permissions.py's fase 8). */
export function LotsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('lot.manage');

  const productFieldId = useId();
  const [productId, setProductId] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const products = useQuery(productsQuery({ activeOnly: true }));
  const { query, setQuery, matches } = useProductSearch(products.data ?? [], {
    onSingleMatch: setProductId,
  });
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

      <div className="mb-4 text-sm text-slate-600">
        <label htmlFor={productFieldId}>Producto</label>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nombre, SKU o código de barras…"
          aria-label="Buscar producto"
          className="mt-1 block w-64 rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select
          id={productFieldId}
          value={productId}
          onChange={(event) => setProductId(event.target.value)}
          className="mt-1 block w-64 rounded border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Elige un producto…</option>
          {matches.map((product) => (
            <option key={product.id} value={product.id}>
              {product.sku} — {product.name}
              {product.track_lots ? '' : ' (no controla lotes)'}
            </option>
          ))}
        </select>
      </div>

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
