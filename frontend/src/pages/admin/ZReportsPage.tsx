import { useQuery } from '@tanstack/react-query';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { zReportSchema, type ZReport } from '@/features/pos/api';
import { API_V1, apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/format';

const zReportsQuery = queryOptions({
  queryKey: ['z-reports'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/z-reports`, { schema: z.array(zReportSchema), signal }),
});

function when(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Los cierres de caja guardados.
 *
 * Cada uno con los totales tal y como se congelaron esa noche: es el papel
 * con el que se cuadró el cajón, y no cambia aunque después se devuelva
 * media compra (ver `app.sales.z_reports`). */
export function ZReportsPage() {
  const reports = useQuery(zReportsQuery);
  const rows: ZReport[] = reports.data ?? [];

  return (
    <section>
      <h1 className="mb-1 text-2xl font-semibold">Cierres de caja (Z)</h1>
      <p className="mb-4 text-sm text-slate-500">
        Los totales de cada turno, tal y como se guardaron al cerrar. No cambian después.
      </p>

      {reports.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {reports.isError && (
        <p className="text-sm text-red-600">No se han podido cargar los cierres.</p>
      )}
      {reports.data && rows.length === 0 && (
        <p className="text-sm text-slate-500">
          Todavía no hay ninguno. Se guarda uno cada vez que se cierra la caja desde el TPV.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Z nº</th>
                <th className="px-4 py-2 font-medium">Cerrado</th>
                <th className="px-4 py-2 font-medium">Desde</th>
                <th className="px-4 py-2 font-medium">Ventas</th>
                <th className="px-4 py-2 font-medium">Efectivo</th>
                <th className="px-4 py-2 font-medium">Tarjeta</th>
                <th className="px-4 py-2 font-medium">Otros</th>
                <th className="px-4 py-2 font-medium">Devuelto</th>
                <th className="px-4 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((report) => (
                <tr key={report.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 font-medium text-slate-800">{report.number}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-600">
                    {when(report.closed_at)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                    {/* La primera Z de una caja no tiene corte anterior:
                        entró todo lo que hubiera hasta entonces. */}
                    {report.covers_from === null ? 'el principio' : when(report.covers_from)}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{report.sales_count}</td>
                  <td className="px-4 py-2">{formatMoney(report.cash_total)}</td>
                  <td className="px-4 py-2">{formatMoney(report.card_total)}</td>
                  <td className="px-4 py-2">{formatMoney(report.other_total)}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {Number(report.returns_total) > 0
                      ? `− ${formatMoney(report.returns_total)}`
                      : '—'}
                  </td>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {formatMoney(report.gross_total)}
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
