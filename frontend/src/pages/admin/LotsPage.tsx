import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { useAuth } from '@/features/auth/useAuth';
import { productsQuery } from '@/features/catalog/api';
import { useProductSearch } from '@/features/catalog/useProductSearch';
import { CreateLotForm } from '@/features/lots/CreateLotForm';
import { LotBalancesPanel } from '@/features/lots/LotBalancesPanel';
import { LotsTable } from '@/features/lots/LotsTable';
import {
  createLot,
  deleteLot,
  lotsQuery,
  updateLot,
  type Lot,
  type LotCreateInput,
  type LotUpdateInput,
} from '@/features/lots/api';
import { ApiError } from '@/lib/api';
import { suppliersQuery } from '@/features/suppliers/api';

/** `/admin/inventory/lots` — gated by `lot.read`; crear lotes y consumir stock por
 * FEFO necesita `lot.manage` (backend/app/rbac/permissions.py's fase 8). */
export function LotsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('lot.manage');

  const productFieldId = useId();
  const [productId, setProductId] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [lotActionError, setLotActionError] = useState<string | null>(null);

  const products = useQuery(productsQuery({ activeOnly: true }));
  const { query, setQuery, matches } = useProductSearch(products.data ?? []);
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
      void queryClient.invalidateQueries({ queryKey: ['lots', 'balances', Number(productId)] });
      setCreateError(null);
    },
    onError: () => setCreateError('No se ha podido crear el lote.'),
  });
  const updateMutation = useMutation({
    mutationFn: ({ lotId, payload }: { lotId: number; payload: LotUpdateInput }) =>
      updateLot(lotId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lots'] });
      setLotActionError(null);
    },
    onError: (error) =>
      setLotActionError(
        error instanceof ApiError ? error.message : 'No se ha podido guardar el lote.',
      ),
  });
  const deleteMutation = useMutation({
    mutationFn: (lotId: number) => deleteLot(lotId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lots'] });
      setLotActionError(null);
    },
    onError: (error) =>
      setLotActionError(
        error instanceof ApiError ? error.message : 'No se ha podido eliminar el lote.',
      ),
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
          placeholder="Nombre o código de barras…"
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
              {product.name}
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
          {lots.data && (
            <LotsTable
              lots={lots.data}
              suppliers={suppliers.data ?? []}
              canManage={canManage}
              isSaving={updateMutation.isPending}
              isDeleting={deleteMutation.isPending}
              actionError={lotActionError}
              onSave={(lotId, payload) => updateMutation.mutateAsync({ lotId, payload })}
              onDelete={(lot: Lot) => {
                if (
                  window.confirm(
                    `¿Eliminar el lote «${lot.lot_number}»? Solo se eliminará si todavía no tiene stock ni movimientos.`,
                  )
                ) {
                  deleteMutation.mutate(lot.id);
                }
              }}
            />
          )}

          <LotBalancesPanel productId={Number(productId)} canManage={canManage} />
        </div>
      )}
    </section>
  );
}
