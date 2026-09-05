import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { closeZReport, type ZReport, xReportPreviewQuery } from '@/features/pos/api';
import { renderXReportTicket, renderZReportTicket } from '@/features/pos/zReportTicket';
import { useBusinessTimezone } from '@/features/settings/useShopSettings';
import { activeTicketPrintProfileQuery } from '@/features/tickets/api';
import { TicketPrintSurface } from '@/features/tickets/TicketPrintSurface';
import { ApiError } from '@/lib/api';
import { formatBusinessDateTime } from '@/lib/businessTime';
import { formatMoney } from '@/lib/format';

interface CloseTillDialogProps {
  warehouseId: number | null;
  mode: 'X' | 'Z';
  onCancel: () => void;
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
 * El resumen X es una foto viva de la jornada y se puede imprimir sin cerrar
 * caja. La Z se emite una única vez, conserva su snapshot y bloquea nuevos
 * cobros/devoluciones económicas de esa jornada.
 */
export function CloseTillDialog({ warehouseId, mode, onCancel, onClosed }: CloseTillDialogProps) {
  const businessTimezone = useBusinessTimezone();
  const preview = useQuery(xReportPreviewQuery(warehouseId));
  const printProfile = useQuery(activeTicketPrintProfileQuery);
  const [closed, setClosed] = useState<ZReport | null>(null);
  const [isPrintActive, setPrintActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeAttemptRef = useRef<string | null>(null);
  const finalReport = preview.data?.final_report ?? null;
  const report = closed ?? finalReport;
  const documentText =
    printProfile.data === undefined
      ? null
      : mode === 'X'
        ? preview.data === undefined
          ? null
          : renderXReportTicket(
              preview.data,
              formatBusinessDateTime(preview.data.generated_at, businessTimezone),
              printProfile.data,
            )
        : report === null
          ? null
          : renderZReportTicket(
              report,
              formatBusinessDateTime(report.closed_at, businessTimezone),
              printProfile.data,
              { reprint: finalReport !== null && closed === null },
            );

  const closeMutation = useMutation({
    mutationFn: (key: string) => closeZReport(warehouseId as number, key),
    onSuccess: (nextReport) => {
      closeAttemptRef.current = null;
      setPrintActive(true);
      setClosed(nextReport);
      setError(null);
    },
    onError: (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'No se ha podido emitir la Z definitiva.'),
  });

  const totals = mode === 'Z' && report !== null ? report : preview.data;
  const openSales = preview.data?.open_sales ?? [];
  const canFinalize = report === null && openSales.length === 0;

  function printCurrent(): void {
    if (documentText !== null) setPrintActive(true);
  }

  function finalize(): void {
    const key = closeAttemptRef.current ?? crypto.randomUUID();
    closeAttemptRef.current = key;
    closeMutation.mutate(key);
  }

  const title =
    mode === 'X'
      ? 'Resumen X de caja'
      : report
        ? `Cierre Z definitivo nº ${report.number}`
        : 'Cerrar jornada (Z definitiva)';

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
      >
        <div className="w-full max-w-md rounded-lg bg-slate-800 p-6 shadow-xl">
          <h2 className="text-xl font-semibold text-slate-50">{title}</h2>
          <p className="mt-1 text-sm text-slate-400">
            {mode === 'X'
              ? 'Consulta e impresión de control. No cierra la jornada ni sustituye la Z.'
              : report
                ? 'Esta Z es definitiva e inalterable. Puedes reimprimir exactamente su snapshot.'
                : 'La Z se emitirá una sola vez. Después no se podrán cobrar ventas ni registrar devoluciones económicas hasta la siguiente jornada.'}
          </p>

          {preview.isPending && totals === undefined && (
            <p className="mt-4 text-slate-400">Calculando…</p>
          )}

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
                <Row label="Ventas brutas" value={formatMoney(totals.gross_total)} strong />
                <Row label="IVA incluido" value={formatMoney(totals.tax_total)} />
              </div>
            </div>
          )}

          {mode === 'Z' && report === null && openSales.length > 0 && (
            <div className="mt-4 rounded border border-amber-700 bg-amber-950/50 px-3 py-2 text-sm text-amber-200">
              <p>
                {openSales.length === 1
                  ? 'Hay una venta sin cobrar. Cóbrala o cancélala antes de emitir la Z:'
                  : `Hay ${openSales.length} ventas sin cobrar. Cóbralas o cancélalas antes de emitir la Z:`}
              </p>
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
          {printProfile.isError && (
            <p role="alert" className="mt-4 text-sm text-red-300">
              No se ha podido cargar el perfil de impresión del ticket.
            </p>
          )}

          <div className="mt-6 flex gap-2 print:hidden">
            {mode === 'X' ? (
              <>
                <button
                  type="button"
                  disabled={documentText === null}
                  onClick={printCurrent}
                  className="pos-button-primary flex-1 rounded-lg py-3 text-base font-semibold disabled:opacity-40"
                >
                  Imprimir resumen X
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  className="pos-button-secondary rounded-lg px-4 py-3 text-base font-medium"
                >
                  Volver al TPV
                </button>
              </>
            ) : report !== null ? (
              <>
                <button
                  type="button"
                  onClick={onClosed}
                  className="pos-button-secondary rounded-lg px-4 py-3 text-base font-medium"
                >
                  Volver al TPV
                </button>
                <button
                  type="button"
                  disabled={documentText === null}
                  onClick={printCurrent}
                  className="pos-button-primary flex-1 rounded-lg py-3 text-base font-semibold disabled:opacity-40"
                >
                  Reimprimir Z
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!canFinalize || closeMutation.isPending || preview.isPending}
                  onClick={finalize}
                  className="pos-button-primary flex-1 rounded-lg py-3 text-base font-semibold disabled:opacity-40"
                >
                  {closeMutation.isPending ? 'Emitiendo…' : 'Emitir Z definitiva e imprimir'}
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
      {isPrintActive && documentText !== null && printProfile.data !== undefined && (
        <TicketPrintSurface
          text={documentText}
          profile={printProfile.data}
          openCashDrawerAfterPrint={mode === 'Z'}
          onDismiss={() => setPrintActive(false)}
        />
      )}
    </>
  );
}
