import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { generateTicket, type Sale, type Ticket } from '@/features/pos/api';
import { useSettledShopFlag } from '@/features/settings/useShopSettings';
import { TicketPrintSurface } from '@/features/tickets/TicketPrintSurface';
import { useSettledQzPrintConfig } from '@/features/tickets/qzConfig';
import { openCashDrawer } from '@/features/tickets/qzPrinter';
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
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const printOnCheckout = useSettledShopFlag('pos.print_ticket_on_checkout', true);
  const qzConfig = useSettledQzPrintConfig();
  const isCashSale = sale.payments.some((payment) => payment.method === 'CASH');

  const printMutation = useMutation({
    mutationFn: () => generateTicket(sale.id),
    onSuccess: setTicket,
  });

  // Una sola vez por venta: generar el ticket es idempotente, pero pedirlo
  // dos veces mandaría dos trabajos a la impresora.
  const { mutate: print } = printMutation;
  const printed = useRef(false);
  const drawerAttempted = useRef(false);

  const openDrawer = useCallback(async () => {
    if (qzConfig === undefined) return;
    drawerAttempted.current = true;
    setDrawerError(null);
    try {
      await openCashDrawer(qzConfig);
    } catch (error) {
      setDrawerError(error instanceof Error ? error.message : 'No se ha podido abrir el cajón.');
    }
  }, [qzConfig]);

  useEffect(() => {
    if (!isCashSale || qzConfig === undefined || drawerAttempted.current) return;
    void openDrawer();
  }, [isCashSale, openDrawer, qzConfig]);

  useEffect(() => {
    // `undefined` = todavía no se sabe si la tienda lo quiere: esperar es
    // lo correcto, porque imprimir no se puede deshacer.
    if (printOnCheckout !== true || printed.current) return;
    printed.current = true;
    print();
  }, [printOnCheckout, print]);

  if (ticket !== null) {
    return (
      <TicketPrintSurface
        text={ticket.rendered_text}
        profile={ticket}
        onDismiss={() => setTicket(null)}
        onPrinted={() => {
          setTicket(null);
          if (printOnCheckout === true) onDismiss();
        }}
      />
    );
  }

  return (
    <aside className="flex h-full w-full max-w-sm flex-col items-center justify-center gap-6 border-l border-slate-700 bg-slate-800/50 p-8 text-center">
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

      {drawerError !== null && (
        <div className="max-w-md rounded border border-amber-500/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
          <p>{drawerError}</p>
          <button
            type="button"
            onClick={() => {
              drawerAttempted.current = false;
              void openDrawer();
            }}
            className="mt-2 font-medium underline"
          >
            Reintentar abrir el cajón
          </button>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => printMutation.mutate()}
          disabled={printMutation.isPending}
          className="pos-button-secondary rounded-lg px-6 py-3 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {printMutation.isPending ? 'Generando…' : 'Imprimir ticket'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="pos-button-primary rounded-lg px-8 py-3 text-base font-semibold"
        >
          Nueva venta
        </button>
      </div>
    </aside>
  );
}
