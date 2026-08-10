import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { mySessionsQuery, revokeSession } from '@/features/auth/api';

/** Sesiones activas del usuario que ha iniciado sesión — nunca las de otro
 * usuario (ver features/auth/api.ts). Pensado para el caso típico de una
 * tienda con varios terminales: un cajero que se dejó la sesión abierta en
 * otro TPV puede cerrarla desde aquí sin tener que ir físicamente hasta él.
 * La sesión actual no se puede cerrar desde esta lista — para eso está
 * "Salir" en el menú, que además limpia la cookie del propio navegador. */
export function SessionsPanel() {
  const sessions = useQuery(mySessionsQuery);
  const queryClient = useQueryClient();

  const revokeMutation = useMutation({
    mutationFn: (sessionId: number) => revokeSession(sessionId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: mySessionsQuery.queryKey }),
  });

  if (sessions.isPending) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (sessions.isError || !sessions.data) {
    return <p className="text-sm text-red-600">No se han podido cargar las sesiones.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Iniciada</th>
            <th className="px-4 py-2 font-medium">Última actividad</th>
            <th className="px-4 py-2 font-medium">Dispositivo</th>
            <th className="px-4 py-2 font-medium">IP</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {sessions.data.map((s) => (
            <tr key={s.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2 text-xs text-slate-500">
                {new Date(s.created_at).toLocaleString('es-ES')}
              </td>
              <td className="px-4 py-2 text-xs text-slate-500">
                {new Date(s.last_seen_at).toLocaleString('es-ES')}
              </td>
              <td className="max-w-xs truncate px-4 py-2 text-xs text-slate-600">
                {s.user_agent ?? '—'}
              </td>
              <td className="px-4 py-2 text-xs text-slate-400">{s.ip ?? '—'}</td>
              <td className="px-4 py-2 text-right">
                {s.is_current ? (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                    Esta sesión
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={revokeMutation.isPending}
                    onClick={() => revokeMutation.mutate(s.id)}
                    className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
                  >
                    Cerrar sesión
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
