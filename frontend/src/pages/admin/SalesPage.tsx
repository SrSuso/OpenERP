import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { salesQuery, type Sale } from '@/features/pos/api';
import { TicketReprintButton } from '@/features/tickets/TicketReprintButton';
import { formatMoney } from '@/lib/format';

// Cancelar borra el carrito, así que aquí no hay canceladas que enseñar.
const STATUS_LABEL: Record<Sale['status'], string> = {
  DRAFT: 'Sin cobrar',
  COMPLETED: 'Cobrada',
  CANCELLED: 'Cancelada',
};

const STATUS_STYLE: Record<Sale['status'], string> = {
  DRAFT: 'bg-amber-50 text-amber-700',
  COMPLETED: 'bg-green-50 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

function today(): string {
  // En hora local, no UTC: "hoy" es el día de la tienda, y a partir de las
  // dos de la mañana en España no son el mismo.
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

/** Las ventas del día, con su ticket a mano.
 *
 * El motivo de que exista: al cerrar el ticket en la caja desaparece el
 * número de la venta, así que un cliente que vuelve a los cinco minutos a
 * por su ticket dejaba sin salida a quien está en el mostrador —
 * reimprimir estaba sólo dentro de Devoluciones y había que saberse el
 * número de memoria.
 *
 * Reimprimir devuelve siempre el texto congelado del ticket original, no
 * uno nuevo con los datos de hoy (ver `TicketReprintButton`). */
export function SalesPage() {
  const [day, setDay] = useState(today());
  const [status, setStatus] = useState<'' | 'DRAFT' | 'COMPLETED'>('');

  const sales = useQuery(salesQuery({ day, ...(status === '' ? {} : { status }) }));

  const rows = sales.data ?? [];
  const charged = rows.filter((sale) => sale.status === 'COMPLETED');
  const takings = charged.reduce((sum, sale) => sum + Number(sale.total), 0);

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">Ventas</h1>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm text-slate-600">
          Día
          <input
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
            className="mt-1 block rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-slate-600">
          Estado
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as '' | 'DRAFT' | 'COMPLETED')}
            className="mt-1 block rounded border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="">Todas</option>
            <option value="COMPLETED">Cobradas</option>
            <option value="DRAFT">Sin cobrar</option>
          </select>
        </label>

        <p className="pb-1.5 text-sm text-slate-600">
          <span className="font-semibold text-slate-800">{charged.length}</span> cobradas ·{' '}
          <span className="font-semibold text-slate-800">{formatMoney(takings.toFixed(2))}</span>
        </p>
      </div>

      {sales.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {sales.isError && <p className="text-sm text-red-600">No se han podido cargar las ventas.</p>}

      {sales.data && rows.length === 0 && (
        <p className="text-sm text-slate-500">No hay ventas ese día.</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Venta</th>
                <th className="px-4 py-2 font-medium">Hora</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">Terminal</th>
                <th className="px-4 py-2 font-medium">Artículos</th>
                <th className="px-4 py-2 font-medium">Total</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((sale) => (
                <tr key={sale.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {/* El número impreso en el ticket. Un carrito sin
                        cobrar todavía no tiene: se marca como tal. */}
                    {sale.number === null ? (
                      <span className="text-slate-400">sin número</span>
                    ) : (
                      `#${sale.number}`
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{timeOf(sale.created_at)}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[sale.status]}`}
                    >
                      {STATUS_LABEL[sale.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {sale.terminal_name ?? 'No asignado'}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{sale.lines.length}</td>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {formatMoney(sale.total)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {/* Sólo una venta cobrada tiene ticket que reimprimir:
                        las demás no llegaron a dárselo a nadie. */}
                    {sale.status === 'COMPLETED' && <TicketReprintButton saleId={sale.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
