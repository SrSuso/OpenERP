import { SEVERITY_LABELS, SEVERITY_STYLES, type Incident } from '@/features/notifications/api';
import { useBusinessTimezone } from '@/features/settings/useShopSettings';
import { formatBusinessDateTime } from '@/lib/businessTime';

interface IncidentsTableProps {
  incidents: Incident[];
  canManage: boolean;
  onResolve: (id: number) => void;
  isResolving: boolean;
}

export function IncidentsTable({
  incidents,
  canManage,
  onResolve,
  isResolving,
}: IncidentsTableProps) {
  const businessTimezone = useBusinessTimezone();
  if (incidents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
        <p className="font-medium text-slate-700">No hay incidencias con estos filtros.</p>
        <p className="mt-1 text-sm text-slate-500">Cuando una regla se cumpla, aparecerá aquí.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Criticidad</th>
            <th className="px-4 py-3 font-medium">Regla</th>
            <th className="px-4 py-3 font-medium">Mensaje</th>
            <th className="px-4 py-3 font-medium">Detectada</th>
            <th className="px-4 py-3 font-medium">Últ. vista</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => (
            <tr
              key={incident.id}
              className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70"
            >
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    SEVERITY_STYLES[incident.severity].badge
                  } ${
                    incident.status === 'OPEN' && SEVERITY_STYLES[incident.severity].blink
                      ? 'animate-pulse'
                      : ''
                  }`}
                >
                  {SEVERITY_LABELS[incident.severity]}
                </span>
              </td>
              <td className="px-4 py-3 font-medium text-slate-800">{incident.rule_name}</td>
              <td className="max-w-xl px-4 py-3 text-slate-700">{incident.message}</td>
              <td className="px-4 py-3 text-xs text-slate-500">
                {formatBusinessDateTime(incident.first_detected_at, businessTimezone)}
              </td>
              <td className="px-4 py-3 text-xs text-slate-500">
                {formatBusinessDateTime(incident.last_seen_at, businessTimezone)}
              </td>
              <td className="px-4 py-3">
                {incident.status === 'OPEN' ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                    Abierta
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                    Resuelta
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {canManage && incident.status === 'OPEN' && (
                  <button
                    type="button"
                    onClick={() => onResolve(incident.id)}
                    disabled={isResolving}
                    className="text-sm font-medium text-brand-700 hover:underline disabled:opacity-50"
                  >
                    Resolver
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
