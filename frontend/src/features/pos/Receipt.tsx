import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { generateTicket, type Sale, type Ticket } from '@/features/pos/api';
import { useSettledShopFlag } from '@/features/settings/useShopSettings';
import { ticketPrintStyle } from '@/features/tickets/printProfile';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';

interface ReceiptProps {
  sale: Sale;
  onDismiss: () => void;
}

function describeError(error: unknown): string {
  return error instanceof ApiError ? error.message : 'No se ha podido generar el ticket.';
}

/**
 * The brief confirmation shown right after a successful checkout (phase
 * 13) — total charged, how it was paid and any change due — plus the
 * means to print an actual 58/80mm ticket (phase 15): generating one is
 * idempotent (`POST /sales/{id}/tickets`), so tapping **Imprimir ticket**
 * again after a misfire just reprints the same frozen text rather than
 * rendering a new one.
 *
 * Por defecto sale solo nada más cobrar (ajuste
 * `pos.print_ticket_on_checkout`): en una caja con cola detrás, un botón
 * más por cliente son cientos de pulsaciones al mes. El botón sigue
 * estando para quien prefiera decidir cada vez, y para reimprimir si la
 * impresora se ha quedado sin papel.
 */
export function Receipt({ sale, onDismiss }: ReceiptProps) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const printOnCheckout = useSettledShopFlag('pos.print_ticket_on_checkout', true);

  const printMutation = useMutation({
    mutationFn: () => generateTicket(sale.id),
    onSuccess: setTicket,
  });

  // Una sola vez por venta: generar el ticket es idempotente, pero pedirlo
  // dos veces mandaría dos trabajos a la impresora.
  const { mutate: print } = printMutation;
  const printed = useRef(false);
  useEffect(() => {
    // `undefined` = todavía no se sabe si la tienda lo quiere: esperar es
    // lo correcto, porque imprimir no se puede deshacer.
    if (printOnCheckout !== true || printed.current) return;
    printed.current = true;
    print();
  }, [printOnCheckout, print]);

  // `.ticket-print-root` (src/index.css) hides the rest of the page for
  // `@media print` — this just has to trigger the browser's print dialog
  // once that text is actually on screen.
  //
  // Y con el ticket ya enviado, de vuelta a una venta nueva sin tocar
  // nada: en una caja con cola detrás, un botón por cliente son cientos de
  // pulsaciones al mes. No se pierde el cambio a devolver, que se ve en la
  // pantalla de cobro mientras se teclea lo que entrega el cliente, y va
  // impreso en el propio ticket.
  //
  // Sólo cuando el ticket ha salido solo: si se ha pedido a mano, es
  // porque alguien quería mirarlo, y ahí manda el botón de cerrar.
  useEffect(() => {
    if (ticket === null) return;
    // `window.print()` no vuelve hasta que el trabajo está mandado, así que
    // el texto sigue en pantalla mientras se imprime.
    window.print();
    if (printOnCheckout === true) onDismiss();
  }, [ticket, printOnCheckout, onDismiss]);

  if (ticket !== null) {
    return (
      <div
        className="ticket-print-root flex h-full flex-1 flex-col items-center justify-center gap-4 bg-slate-900 p-8"
        data-ticket-width={ticket.printable_width_mm}
        style={ticketPrintStyle(ticket)}
      >
        <pre className="max-h-full overflow-auto whitespace-pre-wrap rounded bg-white p-4 font-mono text-xs text-slate-900">
          {ticket.rendered_text}
        </pre>
        <button
          type="button"
          onClick={() => setTicket(null)}
          className="rounded-lg bg-slate-700 px-6 py-2 text-sm font-medium text-slate-50 hover:bg-slate-600 print:hidden"
        >
          Cerrar
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div>
        <p className="text-lg font-medium text-emerald-400">Venta cobrada</p>
        <p className="mt-2 text-4xl font-bold text-slate-50">{formatMoney(sale.total)}</p>
      </div>

      <ul className="w-full max-w-xs space-y-1 text-sm text-slate-300">
        {sale.payments.map((payment) => (
          <li key={payment.id} className="flex justify-between">
            <span>{payment.method === 'CASH' ? 'Efectivo' : 'Tarjeta'}</span>
            <span>{formatMoney(payment.amount)}</span>
          </li>
        ))}
      </ul>

      {Number(sale.change_due) > 0 && (
        <div className="rounded-lg bg-slate-800 px-6 py-3">
          <p className="text-sm text-slate-400">Cambio a entregar</p>
          <p className="text-2xl font-semibold text-slate-50">{formatMoney(sale.change_due)}</p>
        </div>
      )}

      {printMutation.isError && (
        <p role="alert" className="text-sm text-red-400">
          {describeError(printMutation.error)}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => printMutation.mutate()}
          disabled={printMutation.isPending}
          className="rounded-lg bg-slate-700 px-6 py-3 text-base font-semibold text-slate-50 hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {printMutation.isPending ? 'Generando…' : 'Imprimir ticket'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg bg-till-600 px-8 py-3 text-base font-semibold text-white hover:bg-till-500"
        >
          Nueva venta
        </button>
      </div>
    </div>
  );
}
