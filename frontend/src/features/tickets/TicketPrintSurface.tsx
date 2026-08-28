import { useCallback, useEffect, useRef, useState } from 'react';

import { TicketRasterPreview } from '@/features/tickets/TicketRasterPreview';
import { printThermalTicket } from '@/features/tickets/qzPrinter';
import { type TicketPrintProfile } from '@/features/tickets/printProfile';

interface TicketPrintSurfaceProps {
  text: string;
  profile: TicketPrintProfile;
  onDismiss: () => void;
  onPrinted?: () => void;
}

type PrintStatus = 'printing' | 'error';

/** Every thermal output uses the same QZ/ESC-POS path. */
export function TicketPrintSurface({
  text,
  profile,
  onDismiss,
  onPrinted = onDismiss,
}: TicketPrintSurfaceProps) {
  const [status, setStatus] = useState<PrintStatus>('printing');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const printWithQz = useCallback(async () => {
    setStatus('printing');
    setError(null);
    try {
      await printThermalTicket(text, profile);
      onPrinted();
    } catch (printError) {
      setStatus('error');
      setError(
        printError instanceof Error ? printError.message : 'No se ha podido imprimir el ticket.',
      );
    }
  }, [onPrinted, profile, text]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void printWithQz();
  }, [printWithQz]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 p-4">
      <div className="flex max-h-full max-w-3xl flex-col items-center gap-4 overflow-auto rounded-xl bg-slate-100 p-5 shadow-2xl">
        <TicketRasterPreview text={text} profile={profile} compact />
        {status === 'printing' && (
          <p role="status" className="text-sm font-medium text-slate-700">
            Enviando a POSPrinter POS-80 mediante QZ Tray…
          </p>
        )}
        {error !== null && (
          <p role="alert" className="max-w-xl text-center text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          {status === 'error' && (
            <button
              type="button"
              onClick={() => void printWithQz()}
              className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white"
            >
              Reintentar con QZ Tray
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-white"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
