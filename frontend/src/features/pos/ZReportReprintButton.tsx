import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { type ZReport } from '@/features/pos/api';
import { renderZReportTicket } from '@/features/pos/zReportTicket';
import { activeTicketPrintProfileQuery } from '@/features/tickets/api';
import { ticketPageStyle, ticketPrintStyle } from '@/features/tickets/printProfile';
import {
  printActiveDocument,
  useExclusivePrintDocument,
  usePrintPageStyle,
} from '@/features/tickets/useExclusivePrintDocument';

interface ZReportReprintButtonProps {
  report: ZReport;
  closedAtLabel: string;
  className?: string;
}

/** Reimprime una Z histórica desde Administración. Reutiliza el aislamiento
 * de documentos de los tickets de venta, por lo que una impresión cancelada
 * nunca se acumula antes de la siguiente. */
export function ZReportReprintButton({
  report,
  closedAtLabel,
  className = 'rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50',
}: ZReportReprintButtonProps) {
  const printProfile = useQuery(activeTicketPrintProfileQuery);
  const [isPrintActive, setPrintActive] = useState(false);
  const deactivatePrint = useCallback(() => setPrintActive(false), []);
  const activatePrint = useExclusivePrintDocument(deactivatePrint);
  const profile = printProfile.data;
  const text = profile === undefined ? null : renderZReportTicket(report, closedAtLabel, profile);
  const pageStyle =
    text !== null && isPrintActive && profile !== undefined
      ? ticketPageStyle(profile, text.split('\n').length)
      : null;
  usePrintPageStyle(pageStyle);

  // Igual que con una venta reimpresa desde Administración, el portal evita
  // que la tabla de cierres conserve alto y produzca páginas en blanco.
  useLayoutEffect(() => {
    if (!isPrintActive) return;
    document.body.classList.add('printing-ticket-reprint');
    return () => document.body.classList.remove('printing-ticket-reprint');
  }, [isPrintActive]);

  useEffect(() => {
    if (!isPrintActive) return;
    printActiveDocument(deactivatePrint);
  }, [deactivatePrint, isPrintActive]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (profile === undefined) return;
          activatePrint();
          setPrintActive(true);
        }}
        disabled={profile === undefined}
        className={className}
      >
        {printProfile.isPending ? 'Cargando impresión…' : `Reimprimir Z nº ${report.number}`}
      </button>
      {printProfile.isError && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          No se ha podido cargar el perfil de impresión.
        </p>
      )}
      {text !== null &&
        isPrintActive &&
        profile !== undefined &&
        createPortal(
          <div
            className="ticket-print-root flex h-full flex-1 flex-col items-center justify-center gap-4 bg-slate-900 p-8"
            data-print-active="true"
            data-ticket-width={profile.printable_width_mm}
            style={ticketPrintStyle(profile)}
          >
            <pre className="max-h-full overflow-auto whitespace-pre rounded bg-white p-4 font-mono text-xs text-slate-900">
              {text}
            </pre>
            <button
              type="button"
              onClick={deactivatePrint}
              className="rounded-lg bg-slate-700 px-6 py-2 text-sm font-medium text-slate-50 hover:bg-slate-600 print:hidden"
            >
              Cerrar
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
