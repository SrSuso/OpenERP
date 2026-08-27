import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { generateTicket, type Ticket } from '@/features/pos/api';
import { ticketPageStyle, ticketPrintStyle } from '@/features/tickets/printProfile';
import {
  printActiveDocument,
  useExclusivePrintDocument,
  usePrintPageStyle,
} from '@/features/tickets/useExclusivePrintDocument';
import { ApiError } from '@/lib/api';

interface TicketReprintButtonProps {
  saleId: number;
  label?: string;
  className?: string;
}

/** Reimprime el ticket de una venta ya cobrada, fuera del TPV (p.ej. desde
 * Devoluciones, buscando la venta por número) — `POST /sales/{id}/tickets`
 * es idempotente (backend/app/tickets/service.py's `generate_ticket`), así
 * que esto nunca genera un ticket nuevo con el texto de hoy: siempre
 * devuelve el mismo `rendered_text` congelado que se imprimió la primera
 * vez, aunque la plantilla haya cambiado desde entonces. Reutiliza el
 * mismo overlay de impresión que `features/pos/Receipt.tsx`. */
export function TicketReprintButton({
  saleId,
  label = 'Reimprimir ticket',
  className = 'rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50',
}: TicketReprintButtonProps) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [isPrintActive, setPrintActive] = useState(false);
  const deactivatePrint = useCallback(() => setPrintActive(false), []);
  const dismissTicket = useCallback(() => {
    deactivatePrint();
    setTicket(null);
  }, [deactivatePrint]);
  const activatePrint = useExclusivePrintDocument(dismissTicket);
  const pageStyle =
    ticket !== null && isPrintActive
      ? ticketPageStyle(ticket, ticket.rendered_text.split('\n').length)
      : null;
  usePrintPageStyle(pageStyle);

  const mutation = useMutation({
    mutationFn: () => generateTicket(saleId),
    onSuccess: (generated) => {
      activatePrint();
      setPrintActive(true);
      setTicket(generated);
    },
  });

  // Esta vista se monta mediante un portal directamente bajo <body>. Al
  // imprimir desde Administración, dejarla dentro de una fila de la tabla
  // ocultaba el panel pero conservaba toda su altura en el documento, y la
  // impresora térmica avanzaba varias páginas en blanco antes del ticket.
  // La clase permite retirar #root de la maquetación impresa sin afectar la
  // impresión normal que se inicia desde el propio TPV.
  useLayoutEffect(() => {
    if (ticket === null || !isPrintActive) return;
    document.body.classList.add('printing-ticket-reprint');
    return () => document.body.classList.remove('printing-ticket-reprint');
  }, [ticket, isPrintActive]);

  useEffect(() => {
    if (ticket !== null && isPrintActive) {
      printActiveDocument(dismissTicket);
    }
  }, [ticket, isPrintActive, dismissTicket]);

  if (ticket !== null) {
    return createPortal(
      <div
        className="ticket-print-root flex h-full flex-1 flex-col items-center justify-center gap-4 bg-slate-900 p-8"
        data-print-active={isPrintActive ? 'true' : undefined}
        data-ticket-width={ticket.printable_width_mm}
        style={ticketPrintStyle(ticket)}
      >
        <pre className="max-h-full overflow-auto whitespace-pre-wrap rounded bg-white p-4 font-mono text-xs text-slate-900">
          {ticket.rendered_text}
        </pre>
        <button
          type="button"
          onClick={dismissTicket}
          className="rounded-lg bg-slate-700 px-6 py-2 text-sm font-medium text-slate-50 hover:bg-slate-600 print:hidden"
        >
          Cerrar
        </button>
      </div>,
      document.body,
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className={className}
      >
        {mutation.isPending ? 'Generando…' : label}
      </button>
      {mutation.isError && (
        <p className="mt-1 text-sm text-red-600">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : 'No se ha podido generar el ticket.'}
        </p>
      )}
    </div>
  );
}
