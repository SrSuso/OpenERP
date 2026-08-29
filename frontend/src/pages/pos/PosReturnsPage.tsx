import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';

import { usePosAuth } from '@/features/auth/usePosAuth';
import { Keypad } from '@/features/pos/Keypad';
import { saleByNumberQuery } from '@/features/pos/api';
import { CreateReturnForm } from '@/features/returns/CreateReturnForm';
import { createReturn, saleQuery, type ReturnInput } from '@/features/returns/api';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';

/**
 * Supervisory returns remain a POS action, rather than an admin-session
 * action. The backend still enforces `return.manage`; hiding this page from
 * ordinary cashiers is only a convenience, never the security boundary.
 */
export function PosReturnsPage() {
  const { user, hasPermission } = usePosAuth();
  const [saleNumberInput, setSaleNumberInput] = useState('');
  const [isSaleNumberKeypadOpen, setSaleNumberKeypadOpen] = useState(false);
  const [saleNumber, setSaleNumber] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const returnAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const queryClient = useQueryClient();

  const found = useQuery(saleByNumberQuery(saleNumber));
  const saleId = found.data?.id ?? null;
  const sale = useQuery({ ...saleQuery(saleId ?? 0), enabled: saleId !== null });

  const createMutation = useMutation({
    mutationFn: ({ payload, key }: { payload: ReturnInput; key: string }) =>
      createReturn(saleId!, payload, key),
    onSuccess: () => {
      returnAttemptRef.current = null;
      setCreateError(null);
      setSuccess(true);
      void queryClient.invalidateQueries({ queryKey: ['returns', 'sale', saleId] });
      void queryClient.invalidateQueries({ queryKey: ['returns', 'by-sale', saleId] });
      void queryClient.invalidateQueries({ queryKey: ['sales', 'by-number', saleNumber] });
    },
    onError: (error: unknown) => {
      setSuccess(false);
      setCreateError(
        error instanceof ApiError ? error.message : 'No se ha podido registrar la devolución.',
      );
    },
  });

  // `pos/me` is asynchronous. Redirecting while it is still pending would
  // eject an authorized supervisor before their permissions arrive.
  if (!user) return null;
  if (!hasPermission('return.manage')) return <Navigate to="/pos" replace />;

  function search() {
    const number = Number(saleNumberInput);
    if (!Number.isInteger(number) || number <= 0) return;
    returnAttemptRef.current = null;
    setCreateError(null);
    setSuccess(false);
    setSaleNumber(number);
  }

  return (
    <section className="h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Devolución</h1>
          <Link
            to="/pos"
            className="rounded border border-slate-400 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            Volver a venta
          </Link>
        </div>
        <p className="mt-1 text-sm text-slate-300">
          Busca el número del ticket cobrado y registra el reembolso y/o la reposición física.
        </p>

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-200">
            Nº de venta
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={saleNumberInput}
              onChange={(event) => setSaleNumberInput(event.target.value)}
              onClick={() => setSaleNumberKeypadOpen(true)}
              onKeyDown={(event) => event.key === 'Enter' && search()}
              className="mt-1 block w-36 rounded border border-slate-500 bg-slate-800 px-3 py-2 text-base text-white"
            />
          </label>
          <button
            type="button"
            onClick={search}
            className="rounded bg-brand-700 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-600"
          >
            Buscar venta
          </button>
        </div>

        {isSaleNumberKeypadOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Introducir número de venta"
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          >
            <div className="w-full max-w-sm rounded-lg bg-slate-800 p-5 shadow-xl">
              <h2 className="text-lg font-semibold text-slate-50">Número de venta</h2>
              <p className="mt-1 text-sm text-slate-300">
                Introduce el número que aparece en el ticket que quieres devolver.
              </p>
              <output
                aria-live="polite"
                className="mt-4 block rounded border border-slate-600 bg-slate-900 px-4 py-3 text-right text-3xl font-semibold text-slate-50"
              >
                {saleNumberInput || '—'}
              </output>
              <div className="mt-4" aria-label="Teclado numérico para número de venta">
                <Keypad
                  value={saleNumberInput}
                  onChange={setSaleNumberInput}
                  maxLength={9}
                  action={{
                    label: 'Buscar venta',
                    onPress: () => {
                      search();
                      setSaleNumberKeypadOpen(false);
                    },
                    disabled:
                      !Number.isInteger(Number(saleNumberInput)) || Number(saleNumberInput) <= 0,
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => setSaleNumberKeypadOpen(false)}
                className="mt-2 w-full rounded px-4 py-3 text-base font-medium text-slate-300 hover:bg-slate-700"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {saleNumber !== null && (found.isPending || sale.isPending) && (
          <p className="mt-5 text-sm text-slate-300">Buscando…</p>
        )}
        {saleNumber !== null && !found.isPending && (found.isError || found.data === null) && (
          <p className="mt-5 text-sm text-red-300">No se ha encontrado la venta #{saleNumber}.</p>
        )}

        {sale.data && (
          <div className="mt-5 rounded-xl bg-white p-5 text-slate-900 shadow-lg">
            <p className="mb-4 text-sm text-slate-700">
              Venta #{saleNumber} — estado {sale.data.status} — total {formatMoney(sale.data.total)}
            </p>

            {sale.data.status !== 'COMPLETED' && (
              <p className="text-sm text-slate-600">
                Sólo se puede devolver contra una venta completada.
              </p>
            )}

            {sale.data.status === 'COMPLETED' && (
              <>
                {success && (
                  <p
                    role="status"
                    className="mb-3 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
                  >
                    Devolución registrada correctamente.
                  </p>
                )}
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
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
