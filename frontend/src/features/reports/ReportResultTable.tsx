import { columnLabel } from '@/features/reports/columnLabels';
import { type ReportRunResult } from '@/features/reports/api';
import { formatMoney, formatQuantity } from '@/lib/format';

const MONEY_COLUMNS = new Set(['revenue', 'cost']);
const QUANTITY_COLUMNS = new Set(['quantity']);
const INTEGER_COLUMNS = new Set(['tickets', 'lines', 'orders', 'movements']);
const SUMMARY_COLUMNS = new Set([...MONEY_COLUMNS, ...QUANTITY_COLUMNS, ...INTEGER_COLUMNS]);

function formatValue(column: string, value: string | number | null): string {
  if (value === null) return '—';
  const raw = String(value);
  if (MONEY_COLUMNS.has(column)) return formatMoney(raw);
  if (QUANTITY_COLUMNS.has(column)) return formatQuantity(raw);
  if (INTEGER_COLUMNS.has(column)) return new Intl.NumberFormat('es-ES').format(Number(raw));
  return raw;
}

export function ReportResultTable({ result }: { result: ReportRunResult }) {
  if (result.rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
        <p className="font-medium text-slate-700">No hay datos para estos filtros.</p>
        <p className="mt-1 text-sm text-slate-500">
          Prueba a ampliar el período o quitar algún filtro.
        </p>
      </div>
    );
  }

  const isSummary =
    result.rows.length === 1 && result.columns.every((column) => SUMMARY_COLUMNS.has(column));
  const summaryRow = result.rows[0];
  if (isSummary && summaryRow !== undefined) {
    return (
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {result.columns.map((column) => (
          <div key={column} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <dt className="text-sm font-medium text-slate-500">{columnLabel(column)}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {formatValue(column, summaryRow[column] ?? null)}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            {result.columns.map((column) => (
              <th key={column} className="px-4 py-2 font-medium">
                {columnLabel(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, index) => (
            <tr key={index} className="border-b border-slate-100 last:border-0">
              {result.columns.map((column) => (
                <td
                  key={column}
                  className={`px-4 py-2 ${
                    SUMMARY_COLUMNS.has(column) ? 'text-right tabular-nums text-slate-800' : ''
                  }`}
                >
                  {formatValue(column, row[column] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
