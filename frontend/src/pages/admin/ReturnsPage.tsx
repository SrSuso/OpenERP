import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import { CreateReturnForm } from '@/features/returns/CreateReturnForm';
import { ReturnsHistory } from '@/features/returns/ReturnsHistory';
import { createReturn, saleQuery, type ReturnLineInput } from '@/features/returns/api';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';

/** `/admin/returns` — gated by `return.read`; procesar una devolución
 * necesita `return.manage`, ambos restringidos a ADMIN/MANAGER (a
 * diferencia de ventas, revertir dinero/stock de una venta ya cerrada no
 * es tarea rutinaria del cajero — ver backend/app/returns/router.py). */
export function ReturnsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('return.manage');

  const [saleIdInput, setSaleIdInput] = useState('');
  const [saleId, setSaleId] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const sale = useQuery({ ...saleQuery(saleId ?? 0), enabled: saleId !== null });
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (payload: { notes: string; lines: ReturnLineInput[] }) =>
      createReturn(saleId!, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['returns', 'sale', saleId] });
      void queryClient.invalidateQueries({ queryKey: ['returns', 'by-sale', saleId] });
      setCreateError(null);
    },
    onError: (error: unknown) =>
      setCreateError(
        error instanceof ApiError ? error.message : 'No se ha podido registrar la devolución.',
      ),
  });

  function search() {
    const id = Number(saleIdInput);
    if (!Number.isInteger(id) || id <= 0) return;
    setSaleId(id);
  }

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">Devoluciones</h1>

      <div className="mb-4 flex items-end gap-2">
        <label className="text-sm text-slate-600">
          Nº de venta
          <input
            type="text"
            inputMode="numeric"
            value={saleIdInput}
            onChange={(event) => setSaleIdInput(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && search()}
            className="mt-1 block w-32 rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={search}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Buscar
        </button>
      </div>

      {saleId !== null && sale.isPending && <p className="text-sm text-slate-500">Buscando…</p>}
      {saleId !== null && sale.isError && (
        <p className="text-sm text-red-600">No se ha encontrado la venta #{saleId}.</p>
      )}

      {sale.data && (
        <div>
          <p className="mb-3 text-sm text-slate-700">
            Venta #{sale.data.id} — estado {sale.data.status} — total {formatMoney(sale.data.total)}
          </p>

          {sale.data.status !== 'COMPLETED' && (
            <p className="text-sm text-slate-500">
              Sólo se puede devolver contra una venta completada.
            </p>
          )}

          {sale.data.status === 'COMPLETED' && (
            <>
              {canManage && (
                <CreateReturnForm
                  sale={sale.data}
                  isPending={createMutation.isPending}
                  submitError={createError}
                  onSubmit={(payload) => createMutation.mutate(payload)}
                />
              )}
              <h5 className="mb-1 text-xs font-semibold uppercase text-slate-500">
                Devoluciones de esta venta
              </h5>
              <ReturnsHistory saleId={sale.data.id} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
