import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { useAuth } from '@/features/auth/useAuth';
import { CreateReturnForm } from '@/features/returns/CreateReturnForm';
import { ReturnsHistory } from '@/features/returns/ReturnsHistory';
import { saleByNumberQuery } from '@/features/pos/api';
import { createReturn, saleQuery, type ReturnLineInput } from '@/features/returns/api';
import { TicketReprintButton } from '@/features/tickets/TicketReprintButton';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';

/** `/admin/returns` — gated by `return.read`; procesar una devolución
 * necesita `return.manage`, ambos restringidos a ADMIN/MANAGER (a
 * diferencia de ventas, revertir dinero/stock de una venta ya cerrada no
 * es tarea rutinaria del cajero — ver backend/app/returns/router.py). */
export function ReturnsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('return.manage');

  const [saleNumberInput, setSaleNumberInput] = useState('');
  //: Lo que el cliente lee en su ticket, que no es el id interno: un
  //: carrito cancelado no gasta número, así que los dos ya no coinciden.
  const [saleNumber, setSaleNumber] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const returnAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const found = useQuery(saleByNumberQuery(saleNumber));
  const saleId = found.data?.id ?? null;
  const sale = useQuery({ ...saleQuery(saleId ?? 0), enabled: saleId !== null });
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: ({
      payload,
      key,
    }: {
      payload: { notes: string; lines: ReturnLineInput[] };
      key: string;
    }) => createReturn(saleId!, payload, key),
    onSuccess: () => {
      returnAttemptRef.current = null;
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
    const number = Number(saleNumberInput);
    if (!Number.isInteger(number) || number <= 0) return;
    returnAttemptRef.current = null;
    setSaleNumber(number);
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
            value={saleNumberInput}
            onChange={(event) => setSaleNumberInput(event.target.value)}
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

      {saleNumber !== null && (found.isPending || sale.isPending) && (
        <p className="text-sm text-slate-500">Buscando…</p>
      )}
      {saleNumber !== null && !found.isPending && (found.isError || found.data === null) && (
        <p className="text-sm text-red-600">No se ha encontrado la venta #{saleNumber}.</p>
      )}

      {sale.data && (
        <div>
          <p className="mb-3 text-sm text-slate-700">
            Venta #{saleNumber} — estado {sale.data.status} — total {formatMoney(sale.data.total)}
          </p>

          {sale.data.status !== 'COMPLETED' && (
            <p className="text-sm text-slate-500">
              Sólo se puede devolver contra una venta completada.
            </p>
          )}

          {sale.data.status === 'COMPLETED' && (
            <>
              <div className="mb-4">
                <TicketReprintButton saleId={sale.data.id} />
              </div>
              {canManage && (
                <CreateReturnForm
                  sale={sale.data}
                  isPending={createMutation.isPending}
                  submitError={createError}
                  onSubmit={(payload) => {
                    const fingerprint = JSON.stringify(payload);
                    const existing = returnAttemptRef.current;
                    const attempt =
                      existing?.fingerprint === fingerprint
                        ? existing
                        : { fingerprint, key: crypto.randomUUID() };
                    returnAttemptRef.current = attempt;
                    createMutation.mutate({ payload, key: attempt.key });
                  }}
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
