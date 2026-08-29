import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { closeZReport, zReportPreviewQuery, type ZReport } from '@/features/pos/api';
import { renderZReportTicket } from '@/features/pos/zReportTicket';
import { useBusinessTimezone } from '@/features/settings/useShopSettings';
import { activeTicketPrintProfileQuery } from '@/features/tickets/api';
import { TicketPrintSurface } from '@/features/tickets/TicketPrintSurface';
import { ApiError } from '@/lib/api';
import { formatBusinessDateTime } from '@/lib/businessTime';
import { formatMoney } from '@/lib/format';

interface CloseTillDialogProps {
  warehouseId: number | null;
  onCancel: () => void;
  /** Se llama cuando la Z ya está guardada y el cajero vuelve al TPV. */
  onClosed: () => void;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-6 py-1">
      <span className={strong ? 'font-semibold text-slate-100' : 'text-slate-400'}>{label}</span>
      <span className={strong ? 'font-semibold text-slate-50' : 'text-slate-200'}>{value}</span>
    </div>
  );
}

/**
 * El cierre de caja (Z).
 *
 * La Z es un corte explícito de la caja, independiente de la sesión del
 * cajero. Se enseñan los totales antes de confirmar —lo que se ha cobrado y
 * en qué forma de pago— y, una vez cerrada, queda guardada con su número y
 * se puede imprimir. Cambiar de usuario no crea ni descarta una Z.
 *
 * Con una venta a medias no se cierra: ese carrito se cobraría después del
 * corte y descuadraría esta Z y la siguiente. El servidor lo rechaza igual
 * (regla 11); aquí sólo se dice antes de dejar pulsar.
 */
export function CloseTillDialog({ warehouseId, onCancel, onClosed }: CloseTillDialogProps) {
  const businessTimezone = useBusinessTimezone();
  const preview = useQuery(zReportPreviewQuery(warehouseId));
  const printProfile = useQuery(activeTicketPrintProfileQuery);
  const [closed, setClosed] = useState<ZReport | null>(null);
  const [isPrintActive, setPrintActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeAttemptRef = useRef<string | null>(null);
  const closedTicketText =
    closed !== null && printProfile.data !== undefined
      ? renderZReportTicket(
          closed,
          formatBusinessDateTime(closed.closed_at, businessTimezone),
          printProfile.data,
        )
      : null;

  const closeMutation = useMutation({
    mutationFn: (key: string) => closeZReport(warehouseId as number, key),
    onSuccess: (report) => {
      closeAttemptRef.current = null;
      setPrintActive(true);
      setClosed(report);
      setError(null);
    },
    onError: (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'No se ha podido cerrar la caja.'),
  });

  const totals = closed ?? preview.data;
  const openSales = preview.data?.open_sales ?? [];

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cierre de caja"
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
      >
        <div className="w-full max-w-md rounded-lg bg-slate-800 p-6 shadow-xl">
          <h2 className="text-xl font-semibold text-slate-50">
            {closed ? `Cierre Z nº ${closed.number}` : 'Cierre de caja (Z)'}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {closed
              ? 'Guardado. Puedes volver a imprimirlo desde el panel.'
              : 'Estos son los totales del turno desde el último cierre.'}
          </p>

          {preview.isPending && !closed && <p className="mt-4 text-slate-400">Calculando…</p>}

          {totals && (
            <div className="mt-4 border-t border-slate-700 pt-3 text-sm">
              <Row label="Ventas cobradas" value={String(totals.sales_count)} />
              <Row label="Efectivo" value={formatMoney(totals.cash_total)} />
              <Row label="Tarjeta" value={formatMoney(totals.card_total)} />
              <Row label="Otros" value={formatMoney(totals.other_total)} />
              {Number(totals.returns_total) > 0 && (
                <Row
                  label={`Devoluciones (${totals.returns_count})`}
                  value={`− ${formatMoney(totals.returns_total)}`}
                />
              )}
              <div className="mt-2 border-t border-slate-700 pt-2">
                <Row label="Total cobrado" value={formatMoney(totals.gross_total)} strong />
                <Row label="Del que es IVA" value={formatMoney(totals.tax_total)} />
              </div>
            </div>
          )}

          {!closed && openSales.length > 0 && (
            <div className="mt-4 rounded border border-amber-700 bg-amber-950/50 px-3 py-2 text-sm text-amber-200">
              <p>
                {openSales.length === 1
                  ? 'Hay una venta sin cobrar. Cóbrala o cancélala antes de cerrar:'
                  : `Hay ${openSales.length} ventas sin cobrar. Cóbralas o cancélalas antes de cerrar:`}
              </p>
              {/* Cuáles son, con lo que llevan dentro: son las que hay que ir
                a buscar a la barra de ventas abiertas. */}
              <ul className="mt-1 flex flex-col gap-0.5">
                {openSales.map((pending) => (
                  <li key={pending.id}>
                    Venta #{pending.id} — {pending.lines_count}{' '}
                    {pending.lines_count === 1 ? 'línea' : 'líneas'} · {formatMoney(pending.total)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
          {closed !== null && printProfile.isError && (
            <p role="alert" className="mt-4 text-sm text-red-300">
              No se ha podido cargar el perfil de impresión del ticket. Vuelve a intentarlo antes de
              imprimir la Z.
            </p>
          )}

          <div className="mt-6 flex gap-2 print:hidden">
            {closed ? (
              <>
                <button
                  type="button"
                  onClick={onClosed}
                  className="pos-button-primary flex-1 rounded-lg py-3 text-base font-semibold"
                >
                  Volver al TPV
                </button>
                <button
                  type="button"
                  disabled={printProfile.data === undefined}
                  onClick={() => {
                    if (printProfile.data !== undefined) {
                      setPrintActive(true);
                    }
                  }}
                  className="pos-button-secondary rounded-lg px-4 py-3 text-base font-medium disabled:opacity-50"
                >
                  Imprimir otra vez
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={closeMutation.isPending || preview.isPending || openSales.length > 0}
                  onClick={() => {
                    const key = closeAttemptRef.current ?? crypto.randomUUID();
                    closeAttemptRef.current = key;
                    closeMutation.mutate(key);
                  }}
                  className="pos-button-primary flex-1 rounded-lg py-3 text-base font-semibold disabled:opacity-40"
                >
                  {closeMutation.isPending ? 'Cerrando…' : 'Cerrar caja e imprimir Z'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeAttemptRef.current = null;
                    onCancel();
                  }}
                  className="pos-button-secondary rounded-lg px-4 py-3 text-base font-medium"
                >
                  Seguir vendiendo
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {isPrintActive && closedTicketText !== null && printProfile.data !== undefined && (
        <TicketPrintSurface
          text={closedTicketText}
          profile={printProfile.data}
          onDismiss={() => setPrintActive(false)}
        />
      )}
    </>
  );
}
