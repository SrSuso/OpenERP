import { columnLabel } from '@/features/reports/columnLabels';
import { type ReportRunResult } from '@/features/reports/api';

export function ReportResultTable({ result }: { result: ReportRunResult }) {
  if (result.rows.length === 0) {
    return <p className="text-sm text-slate-500">Sin resultados para estos filtros.</p>;
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
                <td key={column} className="px-4 py-2">
                  {row[column] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
