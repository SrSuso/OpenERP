import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { salesQuery } from '@/features/pos/api';
import { usePosTerminal } from '@/features/pos/usePosTerminal';
import { useBusinessTimezone } from '@/features/settings/useShopSettings';
import { TicketReprintButton } from '@/features/tickets/TicketReprintButton';
import { businessDateAt, formatBusinessTime } from '@/lib/businessTime';
import { formatMoney } from '@/lib/format';

/** Historial operativo de la caja actual. Es distinto del listado general
 * de Administración: quien cobra sólo necesita recuperar tickets de su
 * terminal, sin tener que conocer IDs internos ni salir del TPV. */
export function PosTicketsPage() {
  const { selectedTerminal } = usePosTerminal();
  const businessTimezone = useBusinessTimezone();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const day = selectedDay ?? businessDateAt(businessTimezone);
  const terminalId = selectedTerminal?.id;
  const sales = useQuery({
    ...salesQuery({
      day,
      status: 'COMPLETED',
      ...(terminalId === undefined ? {} : { terminalId }),
    }),
    // No hagas ni una petición sin el terminal: además de evitar un
    // parpadeo, el historial de una caja no debe mezclar otras cajas.
    enabled: terminalId !== undefined,
  });

  return (
    <section className="h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Tickets anteriores</h1>
            <p className="mt-1 text-sm text-slate-300">
              {selectedTerminal
                ? `Tickets cobrados en ${selectedTerminal.name}.`
                : 'Selecciona un terminal para consultar sus tickets.'}
            </p>
          </div>
          <Link
            to="/pos"
            className="rounded border border-slate-400 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            Volver a venta
          </Link>
        </div>

        <label className="mt-5 block w-fit text-sm text-slate-200">
          Día
          <input
            type="date"
            value={day}
            onChange={(event) => setSelectedDay(event.target.value)}
            className="mt-1 block rounded border border-slate-500 bg-slate-800 px-3 py-2 text-base text-white"
          />
        </label>

        {sales.isPending && <p className="mt-5 text-sm text-slate-300">Cargando tickets…</p>}
        {sales.isError && (
          <p className="mt-5 text-sm text-red-300">No se han podido cargar los tickets.</p>
        )}
        {sales.data && sales.data.length === 0 && (
          <p className="mt-5 text-sm text-slate-300">
            No hay tickets cobrados ese día en esta caja.
          </p>
        )}

        {sales.data && sales.data.length > 0 && (
          <div className="mt-5 overflow-x-auto rounded-xl bg-white text-slate-900 shadow-lg">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Ticket</th>
                  <th className="px-4 py-3 font-medium">Hora</th>
                  <th className="px-4 py-3 font-medium">Cajero</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {sales.data.map((sale) => (
                  <tr key={sale.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium">#{sale.number}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatBusinessTime(sale.completed_at ?? sale.created_at, businessTimezone)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{sale.cashier_name ?? '—'}</td>
                    <td className="px-4 py-3 font-medium">{formatMoney(sale.total)}</td>
                    <td className="px-4 py-3 text-right">
                      <TicketReprintButton saleId={sale.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
