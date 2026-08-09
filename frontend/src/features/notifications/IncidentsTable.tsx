import { type Incident } from '@/features/notifications/api';

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
  if (incidents.length === 0) {
    return <p className="text-sm text-slate-500">No hay incidencias con estos filtros.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Regla</th>
            <th className="px-4 py-2 font-medium">Mensaje</th>
            <th className="px-4 py-2 font-medium">Detectada</th>
            <th className="px-4 py-2 font-medium">Últ. vista</th>
            <th className="px-4 py-2 font-medium">Estado</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => (
            <tr key={incident.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2 font-medium text-slate-800">{incident.rule_name}</td>
              <td className="px-4 py-2">{incident.message}</td>
              <td className="px-4 py-2 text-xs text-slate-500">
                {new Date(incident.first_detected_at).toLocaleString('es-ES')}
              </td>
              <td className="px-4 py-2 text-xs text-slate-500">
                {new Date(incident.last_seen_at).toLocaleString('es-ES')}
              </td>
              <td className="px-4 py-2">
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
              <td className="px-4 py-2 text-right">
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
