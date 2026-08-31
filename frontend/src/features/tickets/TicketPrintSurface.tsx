import { useCallback, useEffect, useRef, useState } from 'react';

import { TicketRasterPreview } from '@/features/tickets/TicketRasterPreview';
import { useSettledQzPrintConfig } from '@/features/tickets/qzConfig';
import { openCashDrawer, printThermalTicket } from '@/features/tickets/qzPrinter';
import { type TicketPrintProfile } from '@/features/tickets/printProfile';

interface TicketPrintSurfaceProps {
  text: string;
  profile: TicketPrintProfile;
  onDismiss: () => void;
  onPrinted?: () => void;
  /** A Z is a cash-operation document: open the drawer after it is sent. */
  openCashDrawerAfterPrint?: boolean;
}

type PrintStatus = 'loading' | 'printing' | 'opening-drawer' | 'error';

/** Every thermal output uses the same QZ/ESC-POS path. */
export function TicketPrintSurface({
  text,
  profile,
  onDismiss,
  onPrinted = onDismiss,
  openCashDrawerAfterPrint = false,
}: TicketPrintSurfaceProps) {
  const config = useSettledQzPrintConfig();
  const [status, setStatus] = useState<PrintStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  // Do not send the receipt twice when the receipt itself succeeded but the
  // drawer pulse failed. Retrying in that situation must retry only the
  // physical drawer command.
  const ticketSent = useRef(false);

  const printWithQz = useCallback(async () => {
    if (config === undefined) return;
    setStatus('printing');
    setError(null);
    try {
      if (!ticketSent.current) {
        await printThermalTicket(text, profile, config);
        ticketSent.current = true;
      }
      if (openCashDrawerAfterPrint) {
        setStatus('opening-drawer');
        await openCashDrawer(config);
      }
      onPrinted();
    } catch (printError) {
      setStatus('error');
      setError(
        printError instanceof Error ? printError.message : 'No se ha podido imprimir el ticket.',
      );
    }
  }, [config, onPrinted, openCashDrawerAfterPrint, profile, text]);

  useEffect(() => {
    if (config === undefined || started.current) return;
    started.current = true;
    void printWithQz();
  }, [config, printWithQz]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 p-4">
      <div className="flex max-h-full max-w-3xl flex-col items-center gap-4 overflow-auto rounded-xl bg-slate-100 p-5 shadow-2xl">
        <TicketRasterPreview text={text} profile={profile} compact />
        {status === 'loading' && (
          <p role="status" className="text-sm font-medium text-slate-700">
            Cargando la configuración de impresión…
          </p>
        )}
        {status === 'printing' && config !== undefined && (
          <p role="status" className="text-sm font-medium text-slate-700">
            Enviando a {config.printerName} mediante QZ Tray ({config.host}:{config.securePort})…
          </p>
        )}
        {status === 'opening-drawer' && config !== undefined && (
          <p role="status" className="text-sm font-medium text-slate-700">
            Abriendo el cajón mediante {config.printerName}…
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
              {ticketSent.current ? 'Reintentar abrir el cajón' : 'Reintentar con QZ Tray'}
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
