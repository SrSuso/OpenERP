import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { generateTicket } from '@/features/pos/api';
import { ApiError } from '@/lib/api';

interface TicketReprintButtonProps {
  saleId: number;
}

/** Reimprime el ticket de una venta ya cobrada, fuera del TPV (p.ej. desde
 * Devoluciones, buscando la venta por número) — `POST /sales/{id}/tickets`
 * es idempotente (backend/app/tickets/service.py's `generate_ticket`), así
 * que esto nunca genera un ticket nuevo con el texto de hoy: siempre
 * devuelve el mismo `rendered_text` congelado que se imprimió la primera
 * vez, aunque la plantilla haya cambiado desde entonces. Reutiliza el
 * mismo overlay de impresión que `features/pos/Receipt.tsx`. */
export function TicketReprintButton({ saleId }: TicketReprintButtonProps) {
  const [ticketText, setTicketText] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => generateTicket(saleId),
    onSuccess: (ticket) => setTicketText(ticket.rendered_text),
  });

  useEffect(() => {
    if (ticketText !== null) {
      window.print();
    }
  }, [ticketText]);

  if (ticketText !== null) {
    return (
      <div className="ticket-print-root flex h-full flex-1 flex-col items-center justify-center gap-4 bg-slate-900 p-8">
        <pre className="max-h-full overflow-auto whitespace-pre-wrap rounded bg-white p-4 font-mono text-xs text-slate-900">
          {ticketText}
        </pre>
        <button
          type="button"
          onClick={() => setTicketText(null)}
          className="rounded-lg bg-slate-700 px-6 py-2 text-sm font-medium text-slate-50 hover:bg-slate-600 print:hidden"
        >
          Cerrar
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        {mutation.isPending ? 'Generando…' : 'Reimprimir ticket'}
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
