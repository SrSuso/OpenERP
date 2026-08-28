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
export function ThermalPrintDocument({ active, text, profile }: ThermalPrintDocumentProps) {
  const lineCount = Math.max(1, text.split('\n').length);

  useLayoutEffect(() => {
    if (!active) return;
    document.body.classList.add('printing-thermal-document');
    return () => document.body.classList.remove('printing-thermal-document');
  }, [active]);

  if (!active) return null;

  return createPortal(
    <div
      className="ticket-print-root"
      data-print-active="true"
      data-ticket-width={profile.printable_width_mm}
      style={ticketPrintStyle(profile)}
    >
      <style data-ticket-page-style>{ticketPageStyle(profile, lineCount)}</style>
      <pre>{text}</pre>
    </div>,
    document.body,
  );
}
