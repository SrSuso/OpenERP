import { useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

import {
  ticketPageStyle,
  ticketPrintStyle,
  type TicketPrintProfile,
} from '@/features/tickets/printProfile';

interface ThermalPrintDocumentProps {
  active: boolean;
  text: string;
  profile: TicketPrintProfile;
  onDismiss?: () => void;
}

/**
 * The one DOM shape sent to the native print dialog.
 *
 * It is deliberately mounted directly under <body>, outside the POS/admin
 * layouts. Those layouts contain full-height flex containers and scroll
 * regions which otherwise remain in the print formatting tree and can add
 * blank pages or move the receipt. The printer driver owns the continuous
 * roll length; this component owns only the 80 mm paper width, printable
 * area, margins and typography.
 */
export function ThermalPrintDocument({
  active,
  text,
  profile,
  onDismiss,
}: ThermalPrintDocumentProps) {
  useLayoutEffect(() => {
    if (!active) return;
    document.body.classList.add('printing-thermal-document');
    return () => document.body.classList.remove('printing-thermal-document');
  }, [active]);

  if (!active) return null;

  return createPortal(
    <div
      className={
        onDismiss === undefined
          ? 'ticket-print-root'
          : 'ticket-print-root ticket-print-screen fixed inset-0 z-[100] h-full flex-1 flex-col items-center justify-center gap-4 bg-slate-900 p-8'
      }
      data-print-active="true"
      data-ticket-width={profile.printable_width_mm}
      style={ticketPrintStyle(profile)}
    >
      <style data-ticket-page-style>{ticketPageStyle(profile)}</style>
      <pre
        className={
          onDismiss === undefined
            ? undefined
            : 'max-h-full overflow-auto whitespace-pre rounded bg-white p-4 font-mono text-xs text-slate-900'
        }
      >
        {text}
      </pre>
      {onDismiss !== undefined && (
        <button
          type="button"
          onClick={onDismiss}
          className="ticket-print-controls rounded-lg bg-slate-700 px-6 py-2 text-sm font-medium text-slate-50 hover:bg-slate-600"
        >
          Cerrar
        </button>
      )}
    </div>,
    document.body,
  );
}
