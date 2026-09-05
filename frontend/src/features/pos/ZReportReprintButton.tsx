import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { type ZReport } from '@/features/pos/api';
import { renderZReportTicket } from '@/features/pos/zReportTicket';
import { activeTicketPrintProfileQuery } from '@/features/tickets/api';
import { TicketPrintSurface } from '@/features/tickets/TicketPrintSurface';

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
  const profile = printProfile.data;
  const text =
    profile === undefined
      ? null
      : renderZReportTicket(report, closedAtLabel, profile, { reprint: true });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (profile === undefined) return;
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
      {isPrintActive && text !== null && profile !== undefined && (
        <TicketPrintSurface
          text={text}
          profile={profile}
          openCashDrawerAfterPrint
          onDismiss={() => setPrintActive(false)}
        />
      )}
    </>
  );
}
