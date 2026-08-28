import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { type ZReport } from '@/features/pos/api';
import { renderZReportTicket } from '@/features/pos/zReportTicket';
import { activeTicketPrintProfileQuery } from '@/features/tickets/api';
import { ThermalPrintDocument } from '@/features/tickets/ThermalPrintDocument';
import {
  printActiveDocument,
  useExclusivePrintDocument,
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
      {text !== null && profile !== undefined && (
        <ThermalPrintDocument active={isPrintActive} text={text} profile={profile} />
      )}
    </>
  );
}
