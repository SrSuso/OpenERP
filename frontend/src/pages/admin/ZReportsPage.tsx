import { useQuery } from '@tanstack/react-query';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { zReportSchema, type ZReport } from '@/features/pos/api';
import { ZReportReprintButton } from '@/features/pos/ZReportReprintButton';
import { useBusinessTimezone } from '@/features/settings/useShopSettings';
import { API_V1, apiFetch } from '@/lib/api';
import { formatBusinessDateTime } from '@/lib/businessTime';
import { formatMoney } from '@/lib/format';

const zReportsQuery = queryOptions({
  queryKey: ['z-reports'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/z-reports`, { schema: z.array(zReportSchema), signal }),
});

/** Las Z definitivas guardadas. Una vez emitidas se reimprime el snapshot,
 * nunca se recalcula ni se actualiza con operaciones posteriores. */
export function ZReportsPage() {
  const businessTimezone = useBusinessTimezone();
  const reports = useQuery(zReportsQuery);
  const rows: ZReport[] = reports.data ?? [];

  return (
    <section>
      <h1 className="mb-1 text-2xl font-semibold">Cierres de caja (Z)</h1>
      <p className="mb-4 text-sm text-slate-500">
        Una Z definitiva por día comercial y almacén. Conserva los datos del establecimiento,
        impuestos, cobros, devoluciones, terminales y cajeros que había al emitirla.
      </p>

      {reports.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {reports.isError && (
        <p className="text-sm text-red-600">No se han podido cargar los cierres.</p>
      )}
      {reports.data && rows.length === 0 && (
        <p className="text-sm text-slate-500">
          Todavía no hay ninguno. Se emite uno al cerrar la jornada desde el TPV.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Z nº</th>
                <th className="px-4 py-2 font-medium">Jornada</th>
                <th className="px-4 py-2 font-medium">Cerrado</th>
                <th className="px-4 py-2 font-medium">Cerrado por</th>
                <th className="px-4 py-2 font-medium">Inicio de jornada</th>
                <th className="px-4 py-2 font-medium">Ventas</th>
                <th className="px-4 py-2 font-medium">Efectivo</th>
                <th className="px-4 py-2 font-medium">Tarjeta</th>
                <th className="px-4 py-2 font-medium">Otros</th>
                <th className="px-4 py-2 font-medium">Devuelto</th>
                <th className="px-4 py-2 font-medium">Total</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((report) => (
                <tr key={report.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 font-medium text-slate-800">{report.number}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-600">
                    {report.business_date}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-600">
                    {formatBusinessDateTime(report.closed_at, businessTimezone)}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{report.closed_by_name ?? '—'}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                    {/* Las Z antiguas, creadas antes del cierre diario,
                        pueden no conservar el inicio de jornada. */}
                    {report.covers_from === null
                      ? 'el principio'
                      : formatBusinessDateTime(report.covers_from, businessTimezone)}
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
                  <td className="px-4 py-2 text-right">
                    <ZReportReprintButton
                      report={report}
                      closedAtLabel={formatBusinessDateTime(report.closed_at, businessTimezone)}
                    />
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
