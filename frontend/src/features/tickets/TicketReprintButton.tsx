import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { generateTicket, type Ticket } from '@/features/pos/api';
import { ThermalPrintDocument } from '@/features/tickets/ThermalPrintDocument';
import {
  printActiveDocument,
  useExclusivePrintDocument,
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

  const mutation = useMutation({
    mutationFn: () => generateTicket(saleId),
    onSuccess: (generated) => {
      activatePrint();
      setPrintActive(true);
      setTicket(generated);
    },
  });

  useEffect(() => {
    if (ticket !== null && isPrintActive) {
      printActiveDocument(dismissTicket);
    }
  }, [ticket, isPrintActive, dismissTicket]);

  if (ticket !== null) {
    return (
      <ThermalPrintDocument
        active={isPrintActive}
        text={ticket.rendered_text}
        profile={ticket}
        onDismiss={dismissTicket}
      />
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
